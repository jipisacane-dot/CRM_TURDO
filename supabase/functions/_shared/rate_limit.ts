// Rate limit helper compartido. Llama check_rate_limit() en Postgres.
// Usa la IP del cliente + identificador de la función como key.
//
// Uso típico:
//   const rl = await rateLimit(req, 'assistant-chat', 30, 60); // 30 req/min
//   if (rl) return rl; // 429 response
//   ... resto de la lógica ...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function getClientIp(req: Request): string {
  // Supabase edge fns reciben la IP real en cf-connecting-ip o x-forwarded-for
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * Rate limit por IP. Si bloqueado, retorna Response 429; si pasa, retorna null.
 *
 * @param req      Request entrante
 * @param fnName   Identificador único de la función (ej: 'assistant-chat')
 * @param maxHits  Máximo de hits permitidos en la ventana
 * @param windowSec Tamaño de ventana en segundos
 * @param corsHeaders Headers CORS para mezclar en la response 429
 */
export async function rateLimit(
  req: Request,
  fnName: string,
  maxHits: number,
  windowSec: number,
  corsHeaders: Record<string, string> = {}
): Promise<Response | null> {
  const ip = getClientIp(req);
  const key = `${fnName}:${ip}`;

  try {
    const { data, error } = await sb.rpc('check_rate_limit', {
      p_key: key,
      p_max: maxHits,
      p_window_seconds: windowSec,
    });

    if (error) {
      console.warn('[rate_limit] RPC error, dejando pasar:', error.message);
      return null;
    }

    if (data === false) {
      console.warn(`[rate_limit] BLOCKED ${key} (max ${maxHits}/${windowSec}s)`);
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          detail: `Máximo ${maxHits} requests cada ${windowSec}s. Esperá un momento.`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(windowSec),
            ...corsHeaders,
          },
        }
      );
    }
    return null;
  } catch (e) {
    console.warn('[rate_limit] exception, dejando pasar:', e);
    return null;
  }
}
