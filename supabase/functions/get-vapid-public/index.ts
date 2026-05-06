// Devuelve la VAPID public key. Es información pública (la app la necesita
// para suscribirse al push service del browser).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const key = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  return new Response(JSON.stringify({ vapidPublicKey: key }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
