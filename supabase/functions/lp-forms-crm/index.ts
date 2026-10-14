// LP Forms ChatClean: envia os leads do formulário para o CRM ChatClean (API Push) com nota interna.
// Chamada a cada minuto pelo pg_cron (ver migrations/20261008_lp_forms_cron.sql).
//
// Segredos da função (Supabase > Edge Functions > Secrets):
//   CHATCLEAN_PUSH_URL  URL autenticada da API Push do canal, com o ?token=...  (obrigatório)
//   MODO_TESTE          "false" liga o envio de template. Qualquer outro valor (ou ausente) = só nota interna.
//   TEMPLATE_PARCIAL    hsmId do template para quem parou no meio (hoje: comercialretomada3, 2090372418499426)
//   TEMPLATE_COMPLETO   hsmId do template para quem preencheu tudo (vazio = só nota interna)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em toda Edge Function.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUSH_URL = Deno.env.get("CHATCLEAN_PUSH_URL") ?? "";
const MODO_TESTE = (Deno.env.get("MODO_TESTE") ?? "true").toLowerCase() !== "false";
const TEMPLATE_PARCIAL = Deno.env.get("TEMPLATE_PARCIAL") ?? "";
const TEMPLATE_COMPLETO = Deno.env.get("TEMPLATE_COMPLETO") ?? "";

// {{2}} do comercialretomada3: "Olá, {{1}}. Notamos que seu atendimento com {{2}} ficou parado. Deseja continuar de onde parou?"
const CONTEXTO_PARCIAL = "a ChatClean pelo formulário do site";

const ATENDENTES: Record<string, string> = { "1": "Só eu", "2-5": "2 a 5", "6-10": "6 a 10", "11-20": "11 a 20", "21+": "Mais de 20" };
const VOLUME: Record<string, string> = { ate_50: "Até 50", "50_100": "De 50 a 100", mais_100: "Mais de 100", nao_sei: "Não sei dizer" };
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
    payload.params = completo ? [primeiroNome] : [primeiroNome, CONTEXTO_PARCIAL];
  }

  return {
    numeroValido: /^55\d{10,11}$/.test(number),
    campoEnviado: completo ? "crm_complete_sent_at" : "crm_partial_sent_at",
    modo: somenteNota ? "somente_nota" : "template",
    payload,
  };
}

async function atualizarLead(leadId: string, campos: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lp_forms_leads?lead_id=eq.${encodeURIComponent(leadId)}`, {
    method: "PATCH", headers: { ...dbHeaders, Prefer: "return=minimal" }, body: JSON.stringify(campos),
  });
  if (!r.ok) console.error("falha ao atualizar lead", leadId, r.status, await r.text());
}

async function processar(d: Lead) {
  const envio = montarEnvio(d);
  try {
    if (!envio.numeroValido) throw new Error("numero de WhatsApp fora do formato 55 + DDD + numero");
    const r = await fetch(PUSH_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envio.payload), signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`CRM respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
    await atualizarLead(d.lead_id, { [envio.campoEnviado]: new Date().toISOString(), crm_last_error: null });
    return { lead_id: d.lead_id, tipo: d.tipo_envio, modo: envio.modo, ok: true };
  } catch (e) {
    const erro = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await atualizarLead(d.lead_id, { crm_attempts: (d.crm_attempts ?? 0) + 1, crm_last_error: erro });
    return { lead_id: d.lead_id, tipo: d.tipo_envio, modo: envio.modo, ok: false, erro };
  }
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

  const r = await fetch(`${SUPABASE_URL}/rest/v1/lp_forms_leads_pendentes?select=*&limit=20`, { headers: dbHeaders });
  if (!r.ok) return Response.json({ erro: "falha ao ler a fila", detalhe: await r.text() }, { status: 500 });
  const pendentes: Lead[] = await r.json();

  const resultados = await Promise.all(pendentes.map(processar));
  return Response.json({ modo_teste: MODO_TESTE, processados: resultados.length, resultados });
});
