import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VERIFY_TOKEN = Deno.env.get('WA_WEBHOOK_VERIFY_TOKEN') ?? 'turdo_crm_wa_2026';

Deno.serve(async (req) => {
  // Meta webhook verification
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  console.log('WA webhook:', JSON.stringify(body).slice(0, 500));

  const entries = (body.entry as unknown[]) ?? [];
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const changes = (e.changes as unknown[]) ?? [];
    for (const change of changes) {
      const c = change as Record<string, unknown>;
      if ((c.field as string) !== 'messages') continue;
      const value = c.value as Record<string, unknown>;
      const messages = (value.messages as unknown[]) ?? [];
      const waContacts = (value.contacts as unknown[]) ?? [];

      for (const message of messages) {
        const m = message as Record<string, unknown>;
        const from = m.from as string;
        const text = (m.text as Record<string, unknown>)?.body as string | null;
        const msgId = m.id as string;
        const type = m.type as string;

        if (!from || !msgId || type !== 'text' || !text) continue;

        const phone = `+${from.replace(/\D/g, '')}`;
        const contactInfo = waContacts.find((ct: unknown) =>
          (ct as Record<string, unknown>).wa_id === from
        ) as Record<string, unknown> | undefined;
        const name = (contactInfo?.profile as Record<string, unknown>)?.name as string || phone;

        // Look up existing contact by phone + channel (avoid duplicate creation)
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, name')
          .eq('channel', 'whatsapp')
          .eq('phone', phone)
          .maybeSingle();

        let contactId: string;
        if (existing) {
          contactId = existing.id;
          // Update name if it was "Sin nombre" or just a phone number
          if (existing.name === 'Sin nombre' || existing.name === phone) {
            await supabase.from('contacts').update({ name, updated_at: new Date().toISOString() }).eq('id', contactId);
          }
        } else {
          const { data: newContact, error: insertErr } = await supabase
            .from('contacts')
            .insert({ channel: 'whatsapp', phone, name, status: 'new', branch: 'Sucursal Centro' })
            .select('id')
            .single();
          if (insertErr || !newContact) { console.error('Insert error:', insertErr); continue; }
          contactId = newContact.id;
        }

        // Save message (deduplicate by meta_mid)
        await supabase.from('messages').upsert(
          { contact_id: contactId, direction: 'in', content: text, channel: 'whatsapp', meta_mid: msgId, read: false },
          { onConflict: 'meta_mid', ignoreDuplicates: true }
        );

        // Get assigned agent for targeted push
        const { data: fullContact } = await supabase.from('contacts').select('assigned_to').eq('id', contactId).single();
        supabase.functions.invoke('send-push', {
          body: { title: name, body: text.slice(0, 100), contact_id: contactId, url: '/inbox', agent_id: fullContact?.assigned_to ?? undefined },
        }).catch(console.error);

        // Auto-clasificación de etapa del pipeline (fire-and-forget)
        supabase.functions.invoke('classify-message-stage', {
          body: { contact_id: contactId },
        }).catch(console.error);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
