// Backfill WhatsApp phone numbers from ManyChat API
// Run: node backfill-wa-phones.mjs

const SUPABASE_URL = 'https://dmwtyonwivujybvnopqq.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtd3R5b253aXZ1anlidm5vcHFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjcwNTU2NSwiZXhwIjoyMDkyMjgxNTY1fQ.JHlQqksRhHNVBAN3aLk7XkypIGY976v4zqc7iOCySVg';
const MANYCHAT_KEY = '4773988:b9de4bdfc7d583dd18bc1c9d137050c4';

const contacts = [
  { id: '46dc73d8-de8b-4bea-b917-2a248bdf00ff', channel_id: '28884871' },
  { id: '848a249e-3fd8-4518-bb60-5fb0aa386c60', channel_id: '1810535656' },
  { id: '62986755-e3cd-4933-95d6-cc57d3bf65f5', channel_id: '367493495' },
  { id: 'f0b8a52a-e900-4834-a142-21fa1fef5fa9', channel_id: '1238204333' },
  { id: '1a9d4460-315b-4c01-8852-673a1a2df107', channel_id: '1544647849' },
  { id: '5d34def9-b0e4-4e00-801f-21e78686a809', channel_id: '1443702311' },
  { id: 'efd552f6-52ab-4249-844d-0b85ea676334', channel_id: '1959371503' },
  { id: '06163fb5-6924-4d79-a359-e200f35b39d0', channel_id: '1546139966' },
  { id: 'd594702f-5a24-497c-954f-325439dfd0d9', channel_id: '1529027579' },
  { id: '35c1e692-7f64-4995-bd37-7c1128e4e1dc', channel_id: '1805498524' },
  { id: '1812ee51-dee7-4bde-bd3d-1e66d8dd263b', channel_id: '889528970' },
  { id: 'a06cce49-0d4d-4441-8d7b-c1d63458069d', channel_id: '1837218899' },
  { id: 'c91c8b65-0ab2-46fa-9713-a6c01d591afc', channel_id: '1926795679' },
  { id: 'a2d28de8-7497-4fae-9389-2c065da987da', channel_id: '1157990530' },
  { id: 'ddd2e2dc-8fda-40a2-8be6-95bf11e7e316', channel_id: '951842167' },
  { id: 'fffbc2f0-2f37-4053-8c6c-045713d82bf0', channel_id: '285918300' },
  { id: '6b977f24-006b-42dc-9466-223a815b27fc', channel_id: '899569440' },
  { id: '470b6b83-0c36-46b5-a674-aea91004997d', channel_id: '71624462' },
  { id: 'f3278c37-26df-4967-843b-e762abd8de4e', channel_id: '215499838' },
  { id: '894d0105-da59-48e4-8a81-8da93b6727df', channel_id: '148556393' },
  { id: 'e36f2956-8df6-4e43-9f7f-2d4b181953eb', channel_id: '1499723448' },
  { id: '665f24f6-2716-45f9-b596-74ba8a030627', channel_id: '1465867022' },
  { id: 'aef96a2f-c4a1-4156-a0ec-16ecc7f4e5b1', channel_id: '397990229' },
];

async function getMCPhone(subscriberId) {
  const resp = await fetch(
    `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${subscriberId}`,
    { headers: { Authorization: `Bearer ${MANYCHAT_KEY}` } }
  );
  if (!resp.ok) return null;
  const json = await resp.json();
  return json?.data?.whatsapp_phone ?? null;
}

async function updatePhone(id, phone) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phone }),
  });
  return resp.ok;
}

let updated = 0, notFound = 0;
for (const { id, channel_id } of contacts) {
  const phone = await getMCPhone(channel_id);
  if (phone) {
    const ok = await updatePhone(id, phone);
    console.log(`✓ ${channel_id} → ${phone} ${ok ? 'OK' : 'ERROR'}`);
    if (ok) updated++;
  } else {
    console.log(`✗ ${channel_id} → sin teléfono en ManyChat`);
    notFound++;
  }
  await new Promise(r => setTimeout(r, 150)); // rate limit
}

console.log(`\nActualizados: ${updated} / ${contacts.length} | Sin teléfono: ${notFound}`);
