-- ════════════════════════════════════════════════════════════════════════════
-- Tabla para trackear sync de leads de Meta Ads
-- ════════════════════════════════════════════════════════════════════════════
-- Cada form que tenemos pauta tiene un row acá con last_lead_id (cursor)
-- y last_synced_at. La edge fn sync-meta-leads usa eso para no traer
-- leads repetidos en cada corrida.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meta_form_sync (
  form_id text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('vendedores', 'compradores_general', 'project_specific')),
  project_name text,
  default_branch text DEFAULT 'Corrientes',
  last_synced_at timestamptz,
  last_lead_id text,
  total_synced integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE meta_form_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_form_sync_admin ON meta_form_sync FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Seed con los 14 forms activos del script _generate_lists.py
INSERT INTO meta_form_sync (form_id, label, category, project_name, default_branch) VALUES
  ('4543802005896154', 'Brown 2500 v2', 'project_specific', 'Brown 2500', 'Corrientes'),
  ('986310820426875',  'Brown 2500 v1', 'project_specific', 'Brown 2500', 'Corrientes'),
  ('1327508745924501', 'Brown 1600 v2', 'project_specific', 'Brown 1600', 'Corrientes'),
  ('1616734299420420', 'Brown 1600 v1', 'project_specific', 'Brown 1600', 'Corrientes'),
  ('1393407262547897', 'Mono Brown 2100 v1', 'project_specific', 'Mono Brown 2100', 'Corrientes'),
  ('933158079737616',  '3amb Reciclado v1', 'project_specific', '3amb Reciclado 141900', 'Corrientes'),
  ('2736088663437402', 'Reciclado 141K v1', 'project_specific', '3amb Reciclado 141900', 'Corrientes'),
  ('1510988890709431', 'Captacion ALEM v1', 'project_specific', 'Captacion ALEM', 'Alem'),
  ('1480305850209855', 'Compradores v4 calificado', 'compradores_general', NULL, 'Corrientes'),
  ('1302407455198882', 'Compradores v3', 'compradores_general', NULL, 'Corrientes'),
  ('1480039123913341', 'Compradores v2', 'compradores_general', NULL, 'Corrientes'),
  ('1667790154253463', 'Compradores v1', 'compradores_general', NULL, 'Corrientes'),
  ('2498856450534303', 'Vendedores Var C', 'vendedores', NULL, 'Corrientes'),
  ('1568193247600230', 'Vendedores Var B', 'vendedores', NULL, 'Corrientes'),
  ('1771363057602943', 'Vendedores Var A', 'vendedores', NULL, 'Corrientes'),
  ('1768173030810176', 'Vende tu depto v2', 'vendedores', NULL, 'Corrientes')
ON CONFLICT (form_id) DO NOTHING;
