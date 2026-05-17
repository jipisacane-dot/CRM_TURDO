-- ============================================================
-- Fix Security Definer Views — 2026-05-18
-- ============================================================
-- Supabase Security Advisor flagged 21 views en public como SECURITY DEFINER.
-- Esto significa que cualquier user que las consulte bypassea RLS y ve TODO,
-- incluso datos de otros agentes/branches.
--
-- Fix: SET (security_invoker = on) en cada una. Ahora la view ejecuta con
-- los permisos del CALLER, respetando su RLS:
--   - admin (Lety) sigue viendo todo (su RLS no restringe)
--   - agent (vendedor) solo ve sus propios contactos/operations/etc
-- ============================================================

ALTER VIEW public.finance_monthly_totals SET (security_invoker = on);
ALTER VIEW public.v_agent_load SET (security_invoker = on);
ALTER VIEW public.v_audit_log SET (security_invoker = on);
ALTER VIEW public.v_caidas_reasons SET (security_invoker = on);
ALTER VIEW public.v_cashflow_monthly SET (security_invoker = on);
ALTER VIEW public.v_conversion_by_channel SET (security_invoker = on);
ALTER VIEW public.v_duplicate_contacts SET (security_invoker = on);
ALTER VIEW public.v_followups_due SET (security_invoker = on);
ALTER VIEW public.v_forecast_summary SET (security_invoker = on);
ALTER VIEW public.v_funnel_by_agent SET (security_invoker = on);
ALTER VIEW public.v_monthly_summary SET (security_invoker = on);
ALTER VIEW public.v_my_commissions_monthly SET (security_invoker = on);
ALTER VIEW public.v_negotiations_active SET (security_invoker = on);
ALTER VIEW public.v_operations_pending_approval SET (security_invoker = on);
ALTER VIEW public.v_pending_matches SET (security_invoker = on);
ALTER VIEW public.v_pipeline_by_agent SET (security_invoker = on);
ALTER VIEW public.v_pipeline_summary SET (security_invoker = on);
ALTER VIEW public.v_portal_summary SET (security_invoker = on);
ALTER VIEW public.v_published_properties SET (security_invoker = on);
ALTER VIEW public.v_response_time SET (security_invoker = on);
ALTER VIEW public.v_sale_cycle SET (security_invoker = on);
