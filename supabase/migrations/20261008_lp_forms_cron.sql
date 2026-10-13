-- LP Forms ChatClean: agendamento da automação.
-- A cada minuto o pg_cron chama a Edge Function lp-forms-crm, que lê a view lp_forms_leads_pendentes
-- e envia os leads ao CRM ChatClean.
-- Migração apenas ADITIVA: habilita extensões, cria uma função e um job novos.
--
-- Dois segredos ficam no Vault e NÃO neste arquivo (já criados no projeto):
--   lp_forms_function_url  URL da Edge Function
--   lp_forms_cron_secret   segredo aleatório gerado dentro do banco (gen_random_bytes)

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Confere o segredo enviado pelo agendamento contra o valor guardado no Vault.
-- Só a chave de serviço (a Edge Function) pode chamar.
create or replace function public.lp_forms_cron_autorizado(p_segredo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    length(p_segredo) >= 32
    and p_segredo = (select decrypted_secret from vault.decrypted_secrets where name = 'lp_forms_cron_secret'),
    false
  );
$$;

revoke all on function public.lp_forms_cron_autorizado(text) from public, anon, authenticated;
grant execute on function public.lp_forms_cron_autorizado(text) to service_role;

select cron.schedule(
  'lp-forms-crm',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lp_forms_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lp_forms_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);

-- Para pausar:  select cron.unschedule('lp-forms-crm');
