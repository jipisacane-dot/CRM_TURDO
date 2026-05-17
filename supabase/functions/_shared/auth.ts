// Helper compartido de auth check para edge functions.
// Bloquea invocaciones anónimas para evitar drain de Claude API y abuse.
//
// Uso típico:
//   const authError = await requireAuth(req);
//   if (authError) return authError;
//   ...resto de la lógica...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Verifica que la request tenga un JWT válido (de un usuario autenticado o service_role).
 * Devuelve null si OK, o un Response 401 si rechaza.
 *
 * @param req Request entrante
 * @param corsHeaders Headers CORS para mezclar en la response de error (opcional)
 * @returns Response (401) si falla, null si pasa
 */
export async function requireAuth(
  req: Request,
  corsHeaders: Record<string, string> = {}
): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing Authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const token = authHeader.slice('Bearer '.length).trim();

  // Bypass para service_role (cron jobs, edge fns internas que se invocan unas a otras)
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  // Rechazar uso directo del anon_key (sin sesión de user real)
  if (token === SUPABASE_ANON_KEY) {
    return new Response(
      JSON.stringify({ error: 'Anonymous access denied. Login required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Validar JWT con Supabase Auth
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
    return null;
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Auth verification failed', detail: String(e) }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
}
