import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VERIFY_TOKEN = Deno.env.get('IG_WEBHOOK_VERIFY_TOKEN') ?? 'turdo_crm_verify_2026';

Deno.serve(async (req) => {
  // Meta webhook verification (GET)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  console.log('IG webhook received:', JSON.stringify(body).slice(0, 500));

  // Process Instagram messaging events
  const entries = (body.entry as unknown[]) ?? [];
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const messaging = (e.messaging as unknown[]) ?? [];

    for (const event of messaging) {
      const ev = event as Record<string, unknown>;
      const senderId = (ev.sender as Record<string, unknown>)?.id as string;
      const message = ev.message as Record<string, unknown> | null;
      const text = message?.text as string | null;

      if (!senderId || !text || message?.is_echo) continue;

      // Upsert contact using the correct Meta PSID (scoped to this app)
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .upsert(
          {
            channel_id: senderId,
            channel: 'instagram',
            name: 'Sin nombre',
            status: 'new',
            branch: 'Sucursal Centro',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'channel_id,channel', ignoreDuplicates: false }
        )
        .select()
        .single();

      if (contactError) {
        console.error('Contact upsert error:', contactError);
        continue;
      }

      // Save message (deduplicate by meta_mid)
      const metaMid = (message?.mid as string) ?? `ig_${senderId}_${Date.now()}`;
      await supabase.from('messages').upsert(
        {
          contact_id: contact.id,
          direction: 'in',
          content: text,
          channel: 'instagram',
          meta_mid: metaMid,
          read: false,
        },
        { onConflict: 'meta_mid', ignoreDuplicates: true }
      );

      // Push notification — targeted to assigned agent if any
      supabase.functions.invoke('send-push', {
        body: {
          title: contact.name ?? 'Instagram',
          body: text.slice(0, 100),
          contact_id: contact.id,
          url: '/inbox',
          agent_id: (contact as Record<string, unknown>).assigned_to ?? undefined,
        },
      }).catch(console.error);

      // Auto-clasificación de etapa del pipeline (fire-and-forget)
      supabase.functions.invoke('classify-message-stage', {
        body: { contact_id: contact.id },
      }).catch(console.error);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
