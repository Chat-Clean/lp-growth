// IG Forms ChatClean: recebe do n8n/Make os leads do formulário nativo da Meta (Instagram/Facebook Lead Ads)
// e grava em ig_forms_leads. O envio ao CRM é feito pela lp-forms-crm, a cada minuto.
//
// Autenticação: header x-webhook-secret com o valor do segredo ig_forms_webhook_secret (Vault do banco).
//
// Corpo aceito (JSON), em qualquer um destes formatos:
//   1. O lead da Graph API da Meta: { id, created_time, form_id, ad_id, ad_name, adset_id, adset_name,
//      campaign_id, campaign_name, platform, field_data: [{ name, values: [...] }] }
//   2. O lead "simplificado" do n8n (Facebook Lead Ads Trigger): { id, created_time, data: {campo: valor},
//      form: {id, name}, ad: {id, name}, adset: {id, name}, campaign: {id, name} }
//   3. Livre (Make ou outro): { leadgen_id, form_id, form_name, ..., respostas: {campo: valor} }
// Pode vir um lead ou uma lista de leads.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const dbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(texto).filter(Boolean).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

function respostasDo(l: Obj): Record<string, string> {
  const r: Record<string, string> = {};
  if (Array.isArray(l.field_data)) {
    for (const f of l.field_data) if (f?.name) r[String(f.name)] = texto(f.values ?? f.value);
  } else {
    const fonte = (l.respostas && typeof l.respostas === "object") ? l.respostas
      : (l.data && typeof l.data === "object" && !Array.isArray(l.data)) ? l.data : null;
    if (fonte) for (const [k, v] of Object.entries(fonte)) r[k] = texto(v);
  }
  return r;
}

// Procura o primeiro campo com um destes nomes (sem diferenciar maiúsculas, espaços ou hífens).
function campo(r: Record<string, string>, nomes: string[]): string {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s-]+/g, "_");
  const mapa = new Map(Object.entries(r).map(([k, v]) => [norm(k), v]));
  for (const n of nomes) { const v = mapa.get(n); if (v) return v; }
  return "";
}

// A Meta entrega o telefone como a pessoa tem no perfil ou digitou: +55..., 55..., (84) 9...
function whatsapp(v: string): string {
  const d = v.replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(d)) return d;
  if (/^\d{10,11}$/.test(d)) return "55" + d;
  return d;
}

function data(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  const dt = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

function montarLinha(l: Obj) {
  // O aviso cru do webhook da Meta só traz ids; as respostas vêm da Graph API. O n8n/Make já fazem essa busca.
  if (l.object === "page" || l.entry) throw new Error("recebi o aviso cru do webhook da Meta: envie o lead já buscado (com field_data)");
  const leadgenId = texto(l.leadgen_id ?? l.id);
  if (!leadgenId) throw new Error("lead sem id (leadgen_id)");
  const respostas = respostasDo(l);
  if (!Object.keys(respostas).length) throw new Error(`lead ${leadgenId} sem respostas (field_data, data ou respostas)`);

  const nomeCompleto = campo(respostas, ["full_name", "nome_completo", "nome", "name"]) ||
    [campo(respostas, ["first_name", "primeiro_nome"]), campo(respostas, ["last_name", "sobrenome"])].filter(Boolean).join(" ");
  const fone = campo(respostas, ["phone_number", "whatsapp", "telefone", "celular", "phone", "numero_de_telefone"]);

  return {
    leadgen_id: leadgenId,
    nome: nomeCompleto || null,
    whatsapp: fone ? whatsapp(fone) : null,
    email: campo(respostas, ["email", "e_mail"]).toLowerCase() || null,
    respostas,
    form_id: texto(l.form_id ?? l.form?.id) || null,
    form_nome: texto(l.form_name ?? l.form?.name) || null,
    plataforma: texto(l.platform ?? l.plataforma) || null,
    ad_id: texto(l.ad_id ?? l.ad?.id) || null,
    ad_nome: texto(l.ad_name ?? l.ad?.name) || null,
    adset_id: texto(l.adset_id ?? l.adset?.id) || null,
    adset_nome: texto(l.adset_name ?? l.adset?.name) || null,
    campanha_id: texto(l.campaign_id ?? l.campaign?.id) || null,
    campanha_nome: texto(l.campaign_name ?? l.campaign?.name) || null,
    criado_na_meta_em: data(l.created_time),
    payload: l,
    updated_at: new Date().toISOString(),
  };
}

async function autorizado(req: Request): Promise<boolean> {
  const segredo = req.headers.get("x-webhook-secret") ?? "";
  if (segredo.length < 32) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ig_forms_webhook_autorizado`, {
    method: "POST", headers: dbHeaders, body: JSON.stringify({ p_segredo: segredo }),
  });
  return r.ok && (await r.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("use POST", { status: 405 });
  if (!(await autorizado(req))) return new Response("nao autorizado", { status: 401 });

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return Response.json({ ok: false, erro: "corpo não é JSON" }, { status: 400 }); }
  const leads: Obj[] = Array.isArray(corpo) ? corpo : [corpo as Obj];

  const linhas = [], erros = [];
  for (const l of leads) {
    try { linhas.push(montarLinha(l ?? {})); } catch (e) { erros.push(e instanceof Error ? e.message : String(e)); }
  }
  if (!linhas.length) return Response.json({ ok: false, erros }, { status: 400 });

  // Upsert por leadgen_id: a Meta e o n8n/Make podem reenviar o mesmo lead. As colunas de controle do CRM
  // não vão no corpo, então um reenvio atualiza as respostas sem disparar o CRM de novo.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ig_forms_leads?on_conflict=leadgen_id`, {
    method: "POST",
    headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(linhas),
  });
  if (!r.ok) {
    const detalhe = (await r.text()).slice(0, 300);
    console.error("falha ao gravar", r.status, detalhe);
    return Response.json({ ok: false, erro: "falha ao gravar no banco", detalhe }, { status: 500 });
  }
  return Response.json({ ok: true, gravados: linhas.map((l) => l.leadgen_id), erros });
});
