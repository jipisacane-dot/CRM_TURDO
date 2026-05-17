// CORS helper compartido para edge fns que se llaman desde el browser del CRM.
// Whitelist de orígenes: previene que sitios maliciosos invoquen estas fns
// desde el browser del agente (defensa contra CSRF / token theft).
//
// Uso:
//   const cors = buildCors(req);
//   if (!cors) return new Response('Forbidden origin', { status: 403 });
//   if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
//   ...

const ALLOWED_ORIGINS = [
  'https://crm-turdo.vercel.app',
  'https://www.crm-turdo.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];

const isPreviewVercel = (o: string) =>
  /^https:\/\/crm-turdo-[a-z0-9-]+-jipisacane-5891s-projects\.vercel\.app$/.test(o);

/**
 * Construye headers CORS si el origen está en whitelist; null si no.
 * Llamar al principio de cada edge function callable from browser.
 */
export function buildCors(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || isPreviewVercel(origin);
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

/**
 * CORS abierto para endpoints PÚBLICOS (portales, surveys, tracking).
 * NO usar en endpoints que requieren auth.
 */
export const PUBLIC_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
