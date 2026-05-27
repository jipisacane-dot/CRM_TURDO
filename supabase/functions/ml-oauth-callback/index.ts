// Edge function: ml-oauth-callback
// Recibe el code de Mercado Libre después de que el user autoriza la app,
// lo intercambia por access_token + refresh_token, y los guarda en ml_oauth.
//
// Flow:
//   1. User abre URL de autorización (que generamos manualmente con Client ID)
//   2. ML pide login + autorización
//   3. ML redirige a esta function con ?code=XXX
//   4. Esta function POSTea a https://api.mercadolibre.com/oauth/token con:
//        grant_type=authorization_code, code, client_id, client_secret, redirect_uri
//   5. ML responde con { access_token, refresh_token, user_id, expires_in (6h) }
//   6. Guardamos en tabla ml_oauth (singleton row id=1)
//   7. Mostramos página HTML de éxito al user

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/ml-oauth-callback`;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function htmlPage(title: string, body: string, isError = false): Response {
  const color = isError ? '#dc2626' : '#10b981';
  const emoji = isError ? '⚠️' : '✅';
  return new Response(
    `<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Turdo CRM</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
    h1 { color: ${color}; }
    .box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin: 20px 0; }
    code { background: #1f2937; color: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head><body>
  <h1>${emoji} ${title}</h1>
  ${body}
</body></html>`,
    { status: isError ? 400 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  if (error) {
    return htmlPage(
      'Autorización rechazada',
      `<p>Mercado Libre devolvió: <strong>${error}</strong></p>
       <p>${errorDesc ?? ''}</p>
       <p>Volvé al CRM y reintentá si querés.</p>`,
      true
    );
  }

  if (!code) {
    return htmlPage(
      'Falta el code',
      `<p>Esta URL solo se llama desde la redirección de Mercado Libre después de autorizar la app.</p>
       <p>Si querés iniciar la autorización, andá al CRM y apretá "Conectar Mercado Libre".</p>`,
      true
    );
  }

  // Intercambiar code por tokens
  const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    return htmlPage(
      'Error intercambiando code',
      `<div class="box">
        <p><strong>ML respondió ${tokenRes.status}:</strong></p>
        <pre><code>${JSON.stringify(tokenData, null, 2)}</code></pre>
       </div>`,
      true
    );
  }

  const { access_token, refresh_token, user_id, expires_in } = tokenData;
  if (!access_token || !refresh_token) {
    return htmlPage(
      'Respuesta inesperada de ML',
      `<pre><code>${JSON.stringify(tokenData, null, 2)}</code></pre>`,
      true
    );
  }

  const expiresAt = new Date(Date.now() + (expires_in ?? 21600) * 1000).toISOString();

  // Upsert en ml_oauth (singleton)
  const { error: dbErr } = await sb.from('ml_oauth').upsert({
    id: 1,
    access_token,
    refresh_token,
    user_id: user_id ?? null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  if (dbErr) {
    return htmlPage(
      'Tokens recibidos pero error al guardar',
      `<p>${dbErr.message}</p>`,
      true
    );
  }

  return htmlPage(
    'Mercado Libre conectado',
    `<p>El CRM ya puede acceder a tu cuenta de Mercado Libre.</p>
     <div class="box">
       <p><strong>user_id ML:</strong> ${user_id ?? '?'}</p>
       <p><strong>Token vence:</strong> ${expiresAt}</p>
       <p style="color: #6b7280; font-size: 13px">El refresh se renovará automático cada 6h sin que tengas que hacer nada.</p>
     </div>
     <p>Podés cerrar esta pestaña. El próximo sync de leads ML va a usar este token.</p>`
  );
});
