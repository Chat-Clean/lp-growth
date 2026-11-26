-- IG Forms ChatClean: leads do formulário nativo da Meta (Instagram/Facebook Lead Ads).
-- Migração apenas ADITIVA: tabela, views e função novas, todas com o prefixo ig_forms_. Não toca em lp_forms_*.
--
-- Fluxo: Meta -> n8n/Make -> Edge Function ig-forms-webhook (grava aqui) -> Edge Function lp-forms-crm
-- (a cada minuto lê ig_forms_leads_pendentes e envia ao CRM com nota interna, como os leads completos da LP).
-- O formulário nativo só entrega quem ENVIOU, então todo lead aqui é completo: não há etapa parcial.
--
-- Um segredo fica no Vault e NÃO neste arquivo (criado à parte):
--   ig_forms_webhook_secret  valor que o n8n/Make manda no header x-webhook-secret

create table if not exists public.ig_forms_leads (
  leadgen_id               text primary key,          -- id do lead na Meta (o webhook pode repetir: upsert por ele)

  -- contato (extraído das respostas)
  nome                     text,
  whatsapp                 text,                      -- só dígitos, com 55
  email                    text,

  -- todas as perguntas do formulário: { "nome_do_campo": "resposta", ... }
  respostas                jsonb not null default '{}'::jsonb,

  -- origem
  form_id                  text,
  form_nome                text,
  plataforma               text,                      -- ig / fb, quando a Meta informa
  ad_id                    text,
  ad_nome                  text,
  adset_id                 text,
  adset_nome               text,
  campanha_id              text,
  campanha_nome            text,
  criado_na_meta_em        timestamptz,
  payload                  jsonb,                     -- JSON recebido do n8n/Make, para auditoria

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- controle da automação (Edge Function lp-forms-crm -> CRM ChatClean)
  crm_sent_at              timestamptz,
  crm_attempts             integer not null default 0,
  crm_last_error           text,
  crm_etiqueta_at          timestamptz,
  crm_etiqueta_tentativas  integer not null default 0,
  crm_etiqueta_erro        text
);

comment on table public.ig_forms_leads is
  'Leads do formulário nativo da Meta. Gravado pela Edge Function ig-forms-webhook; enviado ao CRM pela lp-forms-crm.';

-- RLS ligado e SEM políticas: só a service role (Edge Functions) lê e escreve.
alter table public.ig_forms_leads enable row level security;

-- Fila de envio ao CRM
create or replace view public.ig_forms_leads_pendentes
with (security_invoker = true) as
select l.*
from public.ig_forms_leads l
where l.crm_sent_at is null
  and l.crm_attempts < 5
order by l.created_at;

-- Fila de etiqueta: já está no CRM e ainda não foi etiquetado
create or replace view public.ig_forms_leads_etiquetar
with (security_invoker = true) as
select l.*
from public.ig_forms_leads l
where l.crm_sent_at is not null
  and l.crm_etiqueta_at is null
  and l.crm_etiqueta_tentativas < 5
order by l.created_at;

-- Uma linha por pergunta respondida, para relatório/planilha
create or replace view public.ig_forms_respostas
with (security_invoker = true) as
select l.leadgen_id, l.form_nome, l.campanha_nome, l.created_at, r.key as pergunta, r.value as resposta
from public.ig_forms_leads l
cross join lateral jsonb_each_text(l.respostas) r;

revoke all on public.ig_forms_leads_pendentes, public.ig_forms_leads_etiquetar, public.ig_forms_respostas
  from anon, authenticated;

-- Confere o segredo do webhook contra o Vault. Só a service role (a Edge Function) pode chamar.
create or replace function public.ig_forms_webhook_autorizado(p_segredo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    length(p_segredo) >= 32
    and p_segredo = (select decrypted_secret from vault.decrypted_secrets where name = 'ig_forms_webhook_secret'),
    false
  );
$$;

revoke all on function public.ig_forms_webhook_autorizado(text) from public, anon, authenticated;
grant execute on function public.ig_forms_webhook_autorizado(text) to service_role;
