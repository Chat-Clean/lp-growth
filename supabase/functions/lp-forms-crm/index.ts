// LP Forms ChatClean: envia ao CRM ChatClean (API Push), com nota interna e etiqueta, os leads do formulário da LP
// (lp_forms_leads) e os do formulário nativo da Meta (ig_forms_leads, gravados pela função ig-forms-webhook).
// Chamada a cada minuto pelo pg_cron (ver migrations/20261008_lp_forms_cron.sql).
//
// Segredos da função (Supabase > Edge Functions > Secrets):
//   CHATCLEAN_PUSH_URL  URL autenticada da API Push do canal, com o ?token=...  (obrigatório)
//   MODO_TESTE          "false" liga o envio de template. Qualquer outro valor (ou ausente) = só nota interna.
//   TEMPLATE_PARCIAL    hsmId do template para quem parou no meio (hoje: comercialretomada3, 2090372418499426)
//   TEMPLATE_COMPLETO   hsmId do template para quem preencheu tudo (vazio = comercialretomada2, 1720828559338994)
//   ETIQUETA_LP         nome da etiqueta aplicada ao contato no CRM (padrão: "Lead LP Forms"). Precisa existir na plataforma.
//   ETIQUETA_LP_ID      id dessa etiqueta na plataforma (padrão: 1062). Usado só para conferir se ela ficou no contato.
//   TEMPLATE_IG         hsmId do template para os leads do formulário da Meta (vazio = só nota interna)
//   ETIQUETA_IG         nome da etiqueta dos leads do formulário da Meta (vazio = a fila de etiqueta deles espera)
//   ETIQUETA_IG_ID      id dessa etiqueta na plataforma (opcional, só para conferência)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em toda Edge Function.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUSH_URL = Deno.env.get("CHATCLEAN_PUSH_URL") ?? "";
const MODO_TESTE = (Deno.env.get("MODO_TESTE") ?? "true").toLowerCase() !== "false";
const TEMPLATE_PARCIAL = Deno.env.get("TEMPLATE_PARCIAL") ?? "";
// comercialretomada2 (Utilidade, canal ChatClean Oficial). O segredo TEMPLATE_COMPLETO, se preenchido, troca o template.
const TEMPLATE_COMPLETO = (Deno.env.get("TEMPLATE_COMPLETO") ?? "").trim() || "1720828559338994";
const ETIQUETA_LP = (Deno.env.get("ETIQUETA_LP") ?? "").trim() || "Lead LP Forms";
const ETIQUETA_LP_ID = (Deno.env.get("ETIQUETA_LP_ID") ?? "").trim() || "1062";
const TEMPLATE_IG = (Deno.env.get("TEMPLATE_IG") ?? "").trim();
const ETIQUETA_IG = (Deno.env.get("ETIQUETA_IG") ?? "").trim();
const ETIQUETA_IG_ID = (Deno.env.get("ETIQUETA_IG_ID") ?? "").trim();

type Etiqueta = { nome: string; id: string };
const ETQ_LP: Etiqueta = { nome: ETIQUETA_LP, id: ETIQUETA_LP_ID };
const ETQ_IG: Etiqueta = { nome: ETIQUETA_IG, id: ETIQUETA_IG_ID };

// {{2}} do comercialretomada3: "Olá, {{1}}. Notamos que seu atendimento com {{2}} ficou parado. Deseja continuar de onde parou?"
const CONTEXTO_PARCIAL = "a ChatClean pelo formulário do site";

// comercialretomada2: "Olá {{1}}, Sua solicitação sobre {{2}}, feita em {{3}}, ainda está aguardando retorno.
// Nosso time está disponível para continuar o atendimento quando você quiser." (botão de resposta rápida "Continuar")
const CONTEXTO_COMPLETO = "a ChatClean pelo formulário do site";

// Data do envio do formulário (dd/mm), no horário de Fortaleza, para o {{3}} do comercialretomada2.
function dataDoFormulario(d: Lead): string {
  const quando = new Date(d.completed_at ?? d.created_at ?? Date.now());
  return quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Fortaleza" });
}

const ATENDENTES: Record<string, string> = { "1": "Só eu", "2-5": "2 a 5", "6-10": "6 a 10", "11-20": "11 a 20", "21+": "Mais de 20" };
const VOLUME: Record<string, string> = { ate_50: "Até 50", "50_100": "De 50 a 100", mais_100: "Mais de 100", nao_sei: "Não consigo contar" };
const SEGMENTO: Record<string, string> = {
  advocacia: "Escritório de advocacia", industria: "Indústria", varejo: "Varejo / loja",
  mercado: "Mercado / supermercado", saude: "Clínica / saúde", servicos: "Serviços", outro: "Outro",
};
const DOR: Record<string, string> = {
  nao_sei_conversao: "Não sei quantos leads viram vendas",
  demora_resposta: "Minha equipe demora para responder",
  sem_acompanhamento: "Não consigo acompanhar todos os atendimentos",
  falta_organizacao: "Perco clientes por falta de organização",
  quero_automatizar: "Quero automatizar parte do atendimento",
};
const ETAPAS: Record<string, string> = {
  whatsapp: "WhatsApp", nome: "Nome", atendentes: "Quantidade de atendentes",
  volume_atendimentos: "Volume de atendimentos", segmento: "Segmento", principal_dor: "Principal dor", email: "E-mail",
};

// deno-lint-ignore no-explicit-any
type Lead = Record<string, any>;

const dbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

function txt(v: unknown, mapa?: Record<string, string>): string {
  const s = (v ?? "").toString().trim();
  if (!s) return "(não respondeu)";
  return mapa?.[s] ?? s;
}

function montarEnvio(d: Lead) {
  const number = (d.whatsapp ?? "").toString().replace(/\D/g, "");
  const completo = d.tipo_envio === "complete";
  const jaAvisadoParcial = completo && !!d.crm_partial_sent_at;
  const etapa = (d.last_step ?? "").toString().replace("_digitando", "");
  const o = d.attribution ?? {};
  const origem = [o.utm_source, o.utm_medium, o.utm_campaign].filter(Boolean).join(" / ") || "direto";

  const nota = [
    completo ? "LEAD DO SITE - formulário COMPLETO" : "LEAD DO SITE - parou no meio do formulário",
    "",
    "WhatsApp: " + number,
    "Nome: " + txt(d.nome),
    "Atendentes: " + txt(d.atendentes, ATENDENTES),
    "Atendimentos por dia: " + txt(d.volume_atendimentos, VOLUME),
    "Segmento: " + txt(d.segmento, SEGMENTO),
    "Principal dor: " + txt(d.principal_dor, DOR),
    "E-mail: " + txt(d.email),
    "",
    completo
      ? "Respondeu todas as etapas."
      : `Última etapa respondida: ${ETAPAS[etapa] ?? etapa} (de ${d.steps_total ?? 7} etapas)`,
    "Origem: " + origem,
    "Protocolo: " + d.lead_id,
  ].join("\n");

  const templateId = completo ? TEMPLATE_COMPLETO : TEMPLATE_PARCIAL;
  // Só nota interna: em teste, sem template configurado, ou quando o lead já recebeu o aviso de parcial e depois concluiu.
  const somenteNota = MODO_TESTE || !templateId || jaAvisadoParcial;
  const primeiroNome = (d.nome ?? "").toString().trim().split(/\s+/)[0] || "tudo bem";

  // deno-lint-ignore no-explicit-any
  const payload: Record<string, any> = {
    number,
    externalKey: `lpforms-${d.lead_id}-${completo ? "completo" : "parcial"}`,
    note: { body: nota },
  };
  if (somenteNota) {
    payload.body = completo ? "Lead do site - formulário completo" : "Lead do site - formulário incompleto";
    payload.onlyNote = true;
  } else {
    payload.templateId = templateId;
    payload.params = completo
      ? [primeiroNome, CONTEXTO_COMPLETO, dataDoFormulario(d)]
      : [primeiroNome, CONTEXTO_PARCIAL];
  }

  return {
    numeroValido: /^55\d{10,11}$/.test(number),
    campoEnviado: completo ? "crm_complete_sent_at" : "crm_partial_sent_at",
    modo: somenteNota ? "somente_nota" : "template",
    payload,
  };
}

async function atualizar(tabela: string, chave: string, id: string, campos: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${chave}=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...dbHeaders, Prefer: "return=minimal" }, body: JSON.stringify(campos),
  });
  if (!r.ok) console.error("falha ao atualizar", tabela, id, r.status, await r.text());
}
const atualizarLead = (leadId: string, campos: Record<string, unknown>) => atualizar("lp_forms_leads", "lead_id", leadId, campos);
const atualizarIg = (leadgenId: string, campos: Record<string, unknown>) => atualizar("ig_forms_leads", "leadgen_id", leadgenId, campos);

// Etiqueta o contato no CRM pela API de Contatos (mesmo servidor e token da URL do Push).
// As rotas /v1/contacts exigem o token no header Bearer; ?token= só funciona na rota do Push.
// Etiquetas são acumulativas: enviar só a nossa não remove as que o contato já tem.
function idValido(id: unknown): number | null {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
}
// Na resposta do Push o "id" da raiz é o do atendimento: do contato só serve o contact.id.
// deno-lint-ignore no-explicit-any
const idNoPush = (j: any) => idValido(j?.contact?.id ?? j?.data?.contact?.id);
// deno-lint-ignore no-explicit-any
const idNaBusca = (j: any) => idValido(j?.id ?? j?.data?.id);
// deno-lint-ignore no-explicit-any
function temEtiqueta(tags: any[], etq: Etiqueta): boolean {
  const alvo = etq.nome.toLowerCase();
  const id = etq.id || "-";
  return tags.some((t) => {
    if (typeof t === "number") return String(t) === id;
    if (typeof t === "string") return t.toLowerCase() === alvo || t === id;
    return String(t?.id ?? t?.tagId ?? "") === id ||
      (t?.tag ?? t?.title ?? t?.name ?? "").toString().toLowerCase() === alvo;
  });
}

async function etiquetar(number: string, respostaPush: unknown, etq: Etiqueta) {
  const url = new URL(PUSH_URL);
  const token = url.searchParams.get("token") ?? "";
  if (!token) throw new Error("token ausente na CHATCLEAN_PUSH_URL");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = `${url.origin}/v1/contacts`;

  let contactId = idNoPush(respostaPush);
  // O WhatsApp registra muitos celulares sem o 9 (ex.: DDD 84), então a plataforma pode ter o contato com
  // 12 dígitos enquanto o formulário guarda 13. Busca pelo número como veio e, se não achar, pela outra forma.
  const formas = [number];
  if (/^55\d{2}9\d{8}$/.test(number)) formas.push(number.slice(0, 4) + number.slice(5));
  else if (/^55\d{2}\d{8}$/.test(number)) formas.push(number.slice(0, 4) + "9" + number.slice(4));
  let ultimaResposta = "";
  for (const forma of formas) {
    if (contactId) break;
    const r = await fetch(`${base}/number/${forma}`, { headers, signal: AbortSignal.timeout(10000) });
    ultimaResposta = await r.text();
    if (!r.ok && r.status !== 404) throw new Error(`busca do contato respondeu ${r.status}: ${ultimaResposta.slice(0, 200)}`);
    try { contactId = idNaBusca(JSON.parse(ultimaResposta)); } catch { /* corpo vazio ou não-JSON */ }
  }
  if (!contactId) throw new Error(`contato não encontrado pelo número (com e sem o 9): ${ultimaResposta.slice(0, 120) || "(resposta vazia)"}`);

  const r = await fetch(`${base}/${contactId}`, {
    method: "PATCH", headers, body: JSON.stringify({ tags: [etq.nome] }), signal: AbortSignal.timeout(10000),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`etiqueta respondeu ${r.status}: ${texto.slice(0, 200)}`);
  // Se a resposta trouxer as etiquetas e a nossa não estiver lá, o PATCH não aplicou (nome diferente do cadastrado?).
  let tags: unknown = null;
  try { const j = JSON.parse(texto); tags = j?.tags ?? j?.data?.tags; } catch { /* resposta sem JSON */ }
  if (Array.isArray(tags) && !temEtiqueta(tags, etq)) throw new Error(`etiqueta "${etq.nome}" não ficou no contato ${contactId}`);
}

// Tenta etiquetar e devolve as colunas de controle da etiqueta para gravar no lead.
// contarTentativa = false no envio: a view de pendentes não traz crm_etiqueta_tentativas, então quem conta é só a fila de etiqueta.
async function tentarEtiqueta(d: Lead, respostaPush: unknown, contarTentativa = true, etq: Etiqueta = ETQ_LP): Promise<Record<string, unknown>> {
  const number = (d.whatsapp ?? "").toString().replace(/\D/g, "");
  try {
    await etiquetar(number, respostaPush, etq);
    return { crm_etiqueta_at: new Date().toISOString(), crm_etiqueta_erro: null };
  } catch (e) {
    const erro = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error("etiqueta", d.lead_id ?? d.leadgen_id, erro);
    return contarTentativa
      ? { crm_etiqueta_tentativas: (d.crm_etiqueta_tentativas ?? 0) + 1, crm_etiqueta_erro: erro }
      : { crm_etiqueta_erro: erro };
  }
}

async function processar(d: Lead) {
  const envio = montarEnvio(d);
  try {
    if (!envio.numeroValido) throw new Error("numero de WhatsApp fora do formato 55 + DDD + numero");
    const r = await fetch(PUSH_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envio.payload), signal: AbortSignal.timeout(15000),
    });
    const resposta = await r.text();
    if (!r.ok) throw new Error(`CRM respondeu ${r.status}: ${resposta.slice(0, 300)}`);

    // O lead já está no CRM. A etiqueta é feita na sequência; se falhar, volta pela fila de etiqueta
    // (lp_forms_leads_etiquetar) nas próximas execuções, sem reenviar a nota nem o template.
    // Quem já foi etiquetado como parcial recebe o PATCH de novo ao concluir: é inofensivo, a etiqueta não duplica.
    let json: unknown = null;
    try { json = JSON.parse(resposta); } catch { /* resposta sem JSON: a etiqueta busca o contato pelo número */ }
    const etiqueta = await tentarEtiqueta(d, json, false);
    await atualizarLead(d.lead_id, { [envio.campoEnviado]: new Date().toISOString(), crm_last_error: null, ...etiqueta });
    return { lead_id: d.lead_id, tipo: d.tipo_envio, modo: envio.modo, ok: true, etiqueta: etiqueta.crm_etiqueta_erro ?? "ok" };
  } catch (e) {
    const erro = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await atualizarLead(d.lead_id, { crm_attempts: (d.crm_attempts ?? 0) + 1, crm_last_error: erro });
    return { lead_id: d.lead_id, tipo: d.tipo_envio, modo: envio.modo, ok: false, erro };
  }
}

// Leads que já estão no CRM e ainda não têm a etiqueta (os enviados antes dela existir e as falhas anteriores).
async function processarEtiqueta(d: Lead) {
  const campos = await tentarEtiqueta(d, null);
  await atualizarLead(d.lead_id, campos);
  return { lead_id: d.lead_id, etiqueta: campos.crm_etiqueta_erro ?? "ok" };
}

/* ---------------- Formulário nativo da Meta (ig_forms_leads) ----------------
   Só chega lead completo (a Meta não entrega quem abandonou), então é um envio por lead, como o "completo" da LP. */

// Campos padrão de contato da Meta, mostrados separados no topo da nota.
const CAMPOS_CONTATO = new Set(["full_name", "first_name", "last_name", "phone_number", "email"]);

// Os nomes de campo da Meta vêm como slug ("quantas_pessoas_atendem?"): deixa legível na nota.
function pergunta(k: string): string {
  const t = k.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function montarEnvioIg(d: Lead) {
  const number = (d.whatsapp ?? "").toString().replace(/\D/g, "");
  const respostas: Record<string, string> = d.respostas ?? {};
  const origem = [d.campanha_nome, d.adset_nome, d.ad_nome].filter(Boolean).join(" / ") || "(sem anúncio: orgânico ou teste)";
  const plataforma = ({ ig: "Instagram", fb: "Facebook" } as Record<string, string>)[d.plataforma ?? ""] ?? (d.plataforma || "Instagram/Facebook");

  const nota = [
    "LEAD DO FORMULÁRIO DA META - " + plataforma,
    "",
    "WhatsApp: " + number,
    "Nome: " + txt(d.nome),
    "E-mail: " + txt(d.email),
    "",
    "Respostas:",
    ...Object.entries(respostas)
      .filter(([k]) => !CAMPOS_CONTATO.has(k.toLowerCase())) // já estão no topo da nota
      .map(([k, v]) => `- ${pergunta(k)}: ${txt(v)}`),
    "",
    "Formulário: " + txt(d.form_nome ?? d.form_id),
    "Origem: " + origem,
    "ID do lead na Meta: " + d.leadgen_id,
  ].join("\n").slice(0, 4000);

  const somenteNota = MODO_TESTE || !TEMPLATE_IG;
  const primeiroNome = (d.nome ?? "").toString().trim().split(/\s+/)[0] || "tudo bem";
  // deno-lint-ignore no-explicit-any
  const payload: Record<string, any> = { number, externalKey: `igforms-${d.leadgen_id}`, note: { body: nota } };
  if (somenteNota) {
    payload.body = "Lead do formulário da Meta";
    payload.onlyNote = true;
  } else {
    payload.templateId = TEMPLATE_IG;
    payload.params = [primeiroNome];
  }
  return { numeroValido: /^55\d{10,11}$/.test(number), modo: somenteNota ? "somente_nota" : "template", payload };
}

async function processarIg(d: Lead) {
  const envio = montarEnvioIg(d);
  try {
    if (!envio.numeroValido) throw new Error("lead sem WhatsApp no formato 55 + DDD + número (o formulário pede telefone?)");
    const r = await fetch(PUSH_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envio.payload), signal: AbortSignal.timeout(15000),
    });
    const resposta = await r.text();
    if (!r.ok) throw new Error(`CRM respondeu ${r.status}: ${resposta.slice(0, 300)}`);

    let json: unknown = null;
    try { json = JSON.parse(resposta); } catch { /* sem JSON: a etiqueta busca o contato pelo número */ }
    // Sem ETIQUETA_IG configurada a etiqueta fica para a fila (ig_forms_leads_etiquetar), sem gastar tentativa.
    const etiqueta = ETIQUETA_IG ? await tentarEtiqueta(d, json, true, ETQ_IG) : {};
    await atualizarIg(d.leadgen_id, { crm_sent_at: new Date().toISOString(), crm_last_error: null, ...etiqueta });
    return { leadgen_id: d.leadgen_id, modo: envio.modo, ok: true, etiqueta: ETIQUETA_IG ? (etiqueta.crm_etiqueta_erro ?? "ok") : "aguardando ETIQUETA_IG" };
  } catch (e) {
    const erro = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await atualizarIg(d.leadgen_id, { crm_attempts: (d.crm_attempts ?? 0) + 1, crm_last_error: erro });
    return { leadgen_id: d.leadgen_id, modo: envio.modo, ok: false, erro };
  }
}

async function processarEtiquetaIg(d: Lead) {
  const campos = await tentarEtiqueta(d, null, true, ETQ_IG);
  await atualizarIg(d.leadgen_id, campos);
  return { leadgen_id: d.leadgen_id, etiqueta: campos.crm_etiqueta_erro ?? "ok" };
}

async function lerFila(view: string): Promise<Lead[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${view}?select=*&limit=20`, { headers: dbHeaders });
  if (!r.ok) { console.error("falha ao ler", view, r.status, await r.text()); return []; }
  return await r.json();
}

// O segredo do agendamento é gerado e guardado no Vault do banco; a conferência é feita lá (lp_forms_cron_autorizado).
async function autorizado(req: Request): Promise<boolean> {
  const segredo = req.headers.get("x-cron-secret") ?? "";
  if (segredo.length < 32) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lp_forms_cron_autorizado`, {
    method: "POST", headers: dbHeaders, body: JSON.stringify({ p_segredo: segredo }),
  });
  return r.ok && (await r.json()) === true;
}

Deno.serve(async (req) => {
  if (!(await autorizado(req))) return new Response("nao autorizado", { status: 401 });
  // Sem a URL do Push nada é enviado e os leads continuam na fila, esperando a configuração.
  if (!PUSH_URL) return Response.json({ aguardando: "segredo CHATCLEAN_PUSH_URL ainda nao configurado", processados: 0 });

  // Primeiro a fila de etiqueta, depois os envios: assim um lead enviado agora não é etiquetado duas vezes na mesma execução.
  const re = await fetch(`${SUPABASE_URL}/rest/v1/lp_forms_leads_etiquetar?select=*&limit=20`, { headers: dbHeaders });
  if (!re.ok) console.error("falha ao ler a fila de etiqueta", re.status, await re.text());
  const etiquetas = re.ok ? await Promise.all(((await re.json()) as Lead[]).map(processarEtiqueta)) : [];

  const r = await fetch(`${SUPABASE_URL}/rest/v1/lp_forms_leads_pendentes?select=*&limit=20`, { headers: dbHeaders });
  if (!r.ok) return Response.json({ erro: "falha ao ler a fila", detalhe: await r.text() }, { status: 500 });
  const pendentes: Lead[] = await r.json();

  const resultados = await Promise.all(pendentes.map(processar));

  // Formulário nativo da Meta: mesma ordem (etiqueta antes do envio). Falha aqui não afeta os leads da LP.
  const etiquetasIg = ETIQUETA_IG ? await Promise.all((await lerFila("ig_forms_leads_etiquetar")).map(processarEtiquetaIg)) : [];
  const resultadosIg = await Promise.all((await lerFila("ig_forms_leads_pendentes")).map(processarIg));

  return Response.json({ modo_teste: MODO_TESTE, processados: resultados.length, resultados, etiquetas, meta: { resultados: resultadosIg, etiquetas: etiquetasIg } });
});
