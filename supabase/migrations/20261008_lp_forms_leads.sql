-- LP Forms ChatClean: leads do formulário (parciais e completos)
-- Migração apenas ADITIVA: cria uma tabela, uma função e uma view novas, todas com o prefixo lp_forms_.
-- Não altera nem remove nada que já exista no projeto.

create table if not exists public.lp_forms_leads (
  lead_id              text primary key,
  stage                text not null default 'partial' check (stage in ('partial', 'complete')),
  last_step            text,
  steps_total          integer,

  -- respostas do formulário (whatsapp é o primeiro campo e o identificador do lead no CRM)
  whatsapp             text not null,
  nome                 text,
  email                text,
  atendentes           text,
  volume_atendimentos  text,
  segmento             text,
  principal_dor        text,

  -- origem / rastreamento
  visitor_id           text,
  event_id             text,
  attribution          jsonb,
  first_touch          jsonb,
  fbp                  text,
  fbc                  text,
  page_url             text,
  user_agent           text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),   -- última atividade do lead no formulário
  completed_at         timestamptz,

  -- controle da automação (n8n -> CRM ChatClean)
  crm_partial_sent_at  timestamptz,   -- aviso de "parou no meio" já enviado
  crm_complete_sent_at timestamptz,   -- aviso de "preencheu tudo" já enviado
  crm_attempts         integer not null default 0,
  crm_last_error       text
);

comment on table public.lp_forms_leads is
  'Leads do formulário da LP ChatClean. Gravado pelo site via RPC lp_forms_salvar_lead; lido pela automação n8n.';

create index if not exists lp_forms_leads_pendentes_idx
  on public.lp_forms_leads (stage, updated_at)
  where crm_partial_sent_at is null or crm_complete_sent_at is null;

-- RLS ligado e SEM políticas: o navegador (anon) não lê nem escreve direto na tabela.
-- O site grava só pela função abaixo; o n8n lê com a service role, que ignora RLS.
alter table public.lp_forms_leads enable row level security;

-- Gravação pelo site: upsert por lead_id, chamado a cada etapa concluída.
create or replace function public.lp_forms_salvar_lead(p_lead jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id  text := left(coalesce(p_lead->>'lead_id', ''), 40);
  v_whatsapp text := coalesce(p_lead->>'whatsapp', '');
  v_stage    text := case when p_lead->>'stage' = 'complete' then 'complete' else 'partial' end;
begin
  if v_lead_id !~ '^CC-[A-Z0-9]{4,20}$' then
    raise exception 'lead_id invalido';
  end if;
  if v_whatsapp !~ '^\+55[1-9][0-9]{9,10}$' then
    raise exception 'whatsapp invalido';
  end if;

  insert into public.lp_forms_leads as l (
    lead_id, stage, last_step, steps_total,
    whatsapp, nome, email, atendentes, volume_atendimentos, segmento, principal_dor,
    visitor_id, event_id, attribution, first_touch, fbp, fbc, page_url, user_agent,
    completed_at
  ) values (
    v_lead_id, v_stage, left(p_lead->>'last_step', 60), nullif(p_lead->>'steps_total', '')::integer,
    v_whatsapp,
    nullif(left(p_lead->>'nome', 120), ''),
    nullif(left(lower(p_lead->>'email'), 160), ''),
    nullif(left(p_lead->>'atendentes', 40), ''),
    nullif(left(p_lead->>'volume_atendimentos', 40), ''),
    nullif(left(p_lead->>'segmento', 40), ''),
    nullif(left(p_lead->>'principal_dor', 60), ''),
    left(p_lead->>'visitor_id', 60), left(p_lead->>'event_id', 60),
    p_lead->'attribution', p_lead->'first_touch',
    left(p_lead->>'fbp', 200), left(p_lead->>'fbc', 300),
    left(p_lead->>'page_url', 1000), left(p_lead->>'user_agent', 400),
    case when v_stage = 'complete' then now() end
  )
  on conflict (lead_id) do update set
    -- um lead completo nunca volta a ser parcial
    stage               = case when l.stage = 'complete' then 'complete' else excluded.stage end,
    last_step           = excluded.last_step,
    steps_total         = coalesce(excluded.steps_total, l.steps_total),
    whatsapp            = excluded.whatsapp,
    nome                = coalesce(excluded.nome, l.nome),
    email               = coalesce(excluded.email, l.email),
    atendentes          = coalesce(excluded.atendentes, l.atendentes),
    volume_atendimentos = coalesce(excluded.volume_atendimentos, l.volume_atendimentos),
    segmento            = coalesce(excluded.segmento, l.segmento),
    principal_dor       = coalesce(excluded.principal_dor, l.principal_dor),
    event_id            = coalesce(nullif(excluded.event_id, ''), l.event_id),
    fbp                 = coalesce(nullif(excluded.fbp, ''), l.fbp),
    fbc                 = coalesce(nullif(excluded.fbc, ''), l.fbc),
    page_url            = excluded.page_url,
    updated_at          = now(),
    completed_at        = coalesce(l.completed_at, excluded.completed_at);
end;
$$;

revoke all on function public.lp_forms_salvar_lead(jsonb) from public;
grant execute on function public.lp_forms_salvar_lead(jsonb) to anon, authenticated;

-- Fila da automação: o que o n8n precisa avisar ao CRM agora.
--   complete -> assim que o lead termina o formulário
--   partial  -> quando o lead está parado há 5 minutos ou mais sem terminar
create or replace view public.lp_forms_leads_pendentes
with (security_invoker = true) as
select
  l.*,
  case when l.stage = 'complete' then 'complete' else 'partial' end as tipo_envio
from public.lp_forms_leads l
where l.crm_attempts < 5
  and (
    (l.stage = 'complete' and l.crm_complete_sent_at is null)
    or (l.stage = 'partial' and l.crm_partial_sent_at is null and l.updated_at < now() - interval '5 minutes')
  )
order by l.updated_at;
