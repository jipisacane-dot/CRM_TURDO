-- =========================================================================
-- Cron jobs: check-expirations diario, nps-survey diario, monthly-summary día 1
-- =========================================================================
-- Horarios en UTC. ART = UTC-3, así que 12 UTC = 9 AM ART, 13 UTC = 10 AM ART.

-- Limpiar si existían
do $$
declare j record;
begin
  for j in select jobid, jobname from cron.job
    where jobname in ('check-expirations-daily','nps-survey-daily','monthly-summary-day1')
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end$$;

-- check-expirations: todos los días 12 UTC (9 AM ART)
select cron.schedule(
  'check-expirations-daily',
  '0 12 * * *',
  $$ select net.http_post(
    url := 'https://dmwtyonwivujybvnopqq.supabase.co/functions/v1/check-expirations',
    headers := '{"Content-Type":"application/json","x-cron-trigger":"pg_cron"}'::jsonb,
    body := '{}'::jsonb
  ); $$
);

-- nps-survey: todos los días 13 UTC (10 AM ART)
select cron.schedule(
  'nps-survey-daily',
  '0 13 * * *',
  $$ select net.http_post(
    url := 'https://dmwtyonwivujybvnopqq.supabase.co/functions/v1/nps-survey',
    headers := '{"Content-Type":"application/json","x-cron-trigger":"pg_cron"}'::jsonb,
    body := '{}'::jsonb
  ); $$
);

-- monthly-summary: día 1 a las 12 UTC (9 AM ART)
select cron.schedule(
  'monthly-summary-day1',
  '0 12 1 * *',
  $$ select net.http_post(
    url := 'https://dmwtyonwivujybvnopqq.supabase.co/functions/v1/monthly-summary',
    headers := '{"Content-Type":"application/json","x-cron-trigger":"pg_cron"}'::jsonb,
    body := '{}'::jsonb
  ); $$
);
