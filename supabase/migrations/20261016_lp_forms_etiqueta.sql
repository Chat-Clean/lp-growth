-- LP Forms ChatClean: etiqueta "Lead LP Forms" no contato do CRM.
-- Migração apenas ADITIVA: três colunas novas em lp_forms_leads e uma view nova.
--
-- A Edge Function lp-forms-crm etiqueta o contato logo depois de enviá-lo ao CRM (parcial ou completo).
-- Se a etiqueta falhar, ou se o lead foi enviado antes desta etiqueta existir, ele entra na fila
-- lp_forms_leads_etiquetar e é tentado de novo a cada execução, até 5 vezes, sem reenviar nota nem template.

alter table public.lp_forms_leads
  add column if not exists crm_etiqueta_at         timestamptz,              -- etiqueta aplicada no contato
  add column if not exists crm_etiqueta_tentativas integer not null default 0,
  add column if not exists crm_etiqueta_erro       text;

create or replace view public.lp_forms_leads_etiquetar
with (security_invoker = true) as
select l.*
from public.lp_forms_leads l
where (l.crm_partial_sent_at is not null or l.crm_complete_sent_at is not null)
  and l.crm_etiqueta_at is null
  and l.crm_etiqueta_tentativas < 5
order by l.updated_at;

-- Só a Edge Function (service role) lê esta fila.
revoke all on public.lp_forms_leads_etiquetar from anon, authenticated;
