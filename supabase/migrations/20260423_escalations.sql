-- Escalation log: tracks which cold/unreplied leads have already been notified,
-- so the cron doesn't re-notify the same lead repeatedly within a cooldown window.

CREATE TABLE IF NOT EXISTS escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS escalations_lookup_idx
  ON escalations (contact_id, type, created_at DESC);

ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;

-- Schedule the escalation cron via pg_cron.
-- The escalate-leads edge function is deployed with --no-verify-jwt so no auth is needed.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: unschedule previous job if any
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'escalate-leads-30min') THEN
    PERFORM cron.unschedule('escalate-leads-30min');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'escalate-leads-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dmwtyonwivujybvnopqq.supabase.co/functions/v1/escalate-leads',
    headers := '{"Content-Type":"application/json","x-cron-trigger":"pg_cron"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
