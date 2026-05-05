// Página pública /c/:token — el cliente final ve esto cuando recibe el link.
// Lee datos via edge function get-portal (sin auth) y trackea eventos en track-portal-event.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface PortalProperty {
  id: string;
  tokko_sku: string | null;
  address: string | null;
  barrio: string | null;
  list_price_usd: number | null;
  rooms: number | null;
  surface_m2: number | null;
  status: string | null;
  description: string | null;
  cover_photo_url: string | null;
  notes: string | null;
}

interface PortalData {
  portal: { id: string; token: string; greeting: string | null; created_at: string };
  contact: { name: string; channel: string } | null;
  agent: { name: string; phone: string | null; avatar_url: string | null; branch: string | null; email: string | null } | null;
  properties: PortalProperty[];
}

const TIME_SLOTS = [
  { day: 'Mañana', slots: ['10:00', '11:30', '16:00'] },
  { day: 'Pasado mañana', slots: ['10:30', '14:00', '17:30'] },
  { day: 'En 3 días', slots: ['10:00', '11:00', '15:00'] },
];

async function track(token: string, event_type: string, event_data: Record<string, unknown> = {}) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/track-portal-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ token, event_type, event_data }),
      keepalive: true,
    });
  } catch {/* ignore */}
}

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePropertyIdx, setActivePropertyIdx] = useState(0);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [showVisit, setShowVisit] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [pickedSlot, setPickedSlot] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState<'visit' | 'question' | null>(null);

  useEffect(() => {
    if (!token) { setError('Link inválido'); setLoading(false); return; }
    fetch(`${SUPABASE_URL}/functions/v1/get-portal?token=${encodeURIComponent(token)}`, {
      headers: { 'apikey': SUPABASE_ANON_KEY },
    })
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `Status ${r.status}`);
        }
        return r.json();
      })
      .then((d: PortalData) => { setData(d); setLoading(false); })
      .catch(e => { setError((e as Error).message); setLoading(false); });
  }, [token]);

  useEffect(() => {
    if (!token || !data) return;
    const onUnload = () => track(token, 'leave');
    let scrolledBottom = false;
    const onScroll = () => {
      if (scrolledBottom) return;
      const total = document.documentElement.scrollHeight;
      const scrolled = window.scrollY + window.innerHeight;
      if (scrolled / total > 0.9) {
        scrolledBottom = true;
        track(token, 'scroll_bottom');
      }
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('scroll', onScroll);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('scroll', onScroll);
    };
  }, [token, data]);

  const property = data?.properties[activePropertyIdx];
  const photos = useMemo(() => {
    // Por ahora mostramos solo cover_photo_url. En la versión 2 sumaremos galería desde Tokko.
    return property?.cover_photo_url ? [property.cover_photo_url] : [];
  }, [property]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Cargando…</div>;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-3">😕</div>
          <h1 className="text-xl font-semibold text-slate-900">Este link no está disponible</h1>
          <p className="text-sm text-slate-500 mt-2 max-w-sm">
            {error === 'Portal expired' ? 'El link expiró. Pedile uno nuevo a tu asesora.' :
             error === 'Portal inactive' ? 'El link fue desactivado.' :
             'Pedile a tu asesora que te genere uno nuevo.'}
          </p>
        </div>
      </div>
    );
  }

  const clientFirstName = (data.contact?.name ?? '').split(' ')[0] || 'Hola';
  const agentFirstName = (data.agent?.name ?? '').split(' ')[0] || 'Tu asesor';
  const agentPhoneDigits = (data.agent?.phone ?? '5492235252984').replace(/\D/g, '');
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${agentPhoneDigits}&text=Hola%20${encodeURIComponent(agentFirstName)}!%20Vi%20el%20link%20que%20me%20mandaste.`;

  return (
    <div className="min-h-screen bg-white text-[#0F172A]">
      <header className="bg-[#8B1F1F] text-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <div className="font-bold text-lg leading-tight">Turdo Inmobiliaria</div>
            <div className="text-[10px] opacity-80 tracking-wider">REAL ESTATE · MAR DEL PLATA</div>
          </div>
          <a href="https://turdogroup.com.ar" className="text-xs bg-white/15 px-3 py-1.5 rounded-full hover:bg-white/25">
            turdogroup.com.ar
          </a>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold">Hola {clientFirstName} 👋</h1>
        <p className="text-slate-600 text-sm mt-1.5 leading-relaxed">
          {data.portal.greeting ?? `Soy ${agentFirstName}. Te preparé este resumen con la propiedad que charlamos. Mirá las fotos, agendá una visita o escribime cualquier duda.`}
        </p>
      </div>

      {/* Selector de propiedad si hay más de una */}
      {data.properties.length > 1 && (
        <div className="max-w-2xl mx-auto px-4 mb-3 flex gap-2 overflow-x-auto pb-2">
          {data.properties.map((p, i) => (
            <button
              key={p.id}
              onClick={() => { setActivePropertyIdx(i); setActivePhotoIdx(0); }}
              className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium border-2 transition-colors ${i === activePropertyIdx ? 'bg-[#8B1F1F] text-white border-[#8B1F1F]' : 'bg-white text-slate-600 border-slate-200'}`}
            >
              {p.tokko_sku ?? `Opción ${i+1}`}
            </button>
          ))}
        </div>
      )}

      {!property ? (
        <div className="max-w-2xl mx-auto px-4 py-12 text-center text-slate-500">
          Sin propiedades en este link.
        </div>
      ) : (
        <>
          <div className="max-w-2xl mx-auto px-4">
            {photos.length > 0 ? (
              <div className="relative cursor-pointer rounded-2xl overflow-hidden bg-slate-100" onClick={() => { setShowLightbox(true); track(token!, 'photo_open', { property_id: property.id, idx: activePhotoIdx }); }}>
                <img src={photos[activePhotoIdx]} alt="" className="w-full aspect-[16/10] object-cover" />
                {photos.length > 1 && (
                  <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full">
                    {activePhotoIdx + 1} / {photos.length}
                  </div>
                )}
              </div>
            ) : (
              <div className="aspect-[16/10] bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl flex items-center justify-center text-slate-400">
                Sin foto disponible
              </div>
            )}

            <div className="mt-5 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold leading-tight">
                  {property.barrio ? `${property.tokko_sku ? property.tokko_sku + ' · ' : ''}${property.barrio}` : (property.tokko_sku ?? 'Propiedad')}
                </h2>
                <p className="text-sm text-slate-600 mt-1">📍 {property.address ?? '—'}</p>
                {property.status && <p className="text-xs text-slate-500">{property.status}</p>}
              </div>
              {property.list_price_usd && (
                <div className="bg-[#8B1F1F] text-white px-4 py-3 rounded-xl text-right">
                  <div className="text-[10px] opacity-80 uppercase tracking-wider">Precio</div>
                  <div className="text-xl font-bold">USD {property.list_price_usd.toLocaleString('es-AR')}</div>
                </div>
              )}
            </div>
          </div>

          <div className="max-w-2xl mx-auto px-4 mt-5">
            <div className="grid grid-cols-3 gap-2">
              <Spec icon="🏠" label="Ambientes" value={property.rooms ? String(property.rooms) : '—'} />
              <Spec icon="📐" label="m² cub." value={property.surface_m2 ? String(property.surface_m2) : '—'} />
              <Spec icon="📍" label="Barrio" value={property.barrio ?? '—'} />
            </div>
          </div>

          {property.description && (
            <div className="max-w-2xl mx-auto px-4 mt-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">Sobre la propiedad</h3>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{property.description}</p>
            </div>
          )}

          <div className="max-w-2xl mx-auto px-4 mt-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">Ubicación</h3>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent((property.address ?? '') + ', Mar del Plata, Argentina')}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => track(token!, 'map_click', { property_id: property.id })}
              className="block aspect-[16/9] bg-gradient-to-br from-emerald-50 via-blue-50 to-blue-100 rounded-2xl border border-slate-200 flex items-center justify-center text-center"
            >
              <div>
                <div className="text-4xl mb-1">📍</div>
                <div className="text-sm font-medium">{property.address ?? '—'}</div>
                <div className="text-xs text-slate-500 mt-0.5">Tocá para abrir en Google Maps</div>
              </div>
            </a>
          </div>
        </>
      )}

      {/* CTA sticky */}
      <div className="h-32" />
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <div className="max-w-2xl mx-auto grid grid-cols-2 gap-2">
          <button onClick={() => setShowVisit(true)} className="bg-[#8B1F1F] hover:bg-[#A52828] text-white py-3 rounded-xl font-medium text-sm">
            📅 Agendar visita
          </button>
          <button onClick={() => setShowQuestion(true)} className="bg-white border-2 border-[#8B1F1F] text-[#8B1F1F] py-3 rounded-xl font-medium text-sm">
            💬 Hacer una pregunta
          </button>
        </div>
      </div>

      {/* Tarjeta del vendedor */}
      <div className="max-w-2xl mx-auto px-4 mt-8 mb-32">
        <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-4 border border-slate-200">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Tu asesor</div>
          <div className="flex items-center gap-3">
            {data.agent?.avatar_url ? (
              <img src={data.agent.avatar_url} className="w-14 h-14 rounded-full object-cover flex-shrink-0" alt="" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#8B1F1F] text-white flex items-center justify-center font-bold text-xl flex-shrink-0">
                {agentFirstName.charAt(0)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{data.agent?.name ?? 'Asesor Turdo'}</div>
              {data.agent?.branch && <div className="text-xs text-slate-500">{data.agent.branch}</div>}
            </div>
            <a
              href={whatsappUrl}
              onClick={() => track(token!, 'whatsapp_click')}
              target="_blank"
              rel="noreferrer"
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap"
            >
              WhatsApp
            </a>
          </div>
        </div>
      </div>

      <footer className="border-t border-slate-200 py-6 px-4 text-center">
        <div className="font-bold text-sm">Turdo Group</div>
        <div className="text-[10px] text-slate-500 mt-1">Real Estate · Mar del Plata · Sucursales Centro · Norte</div>
      </footer>

      {/* Modal: Agendar visita */}
      {showVisit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setShowVisit(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-lg">📅 Agendar visita</h3>
              <button onClick={() => setShowVisit(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4">
              {submitted === 'visit' ? (
                <div className="py-8 text-center">
                  <div className="text-5xl mb-3">✅</div>
                  <h4 className="font-semibold text-lg">¡Listo!</h4>
                  <p className="text-sm text-slate-600 mt-1">{agentFirstName} te confirma por WhatsApp en breve.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600 mb-3">Tocá un horario y te confirmamos por WhatsApp.</p>
                  {TIME_SLOTS.map(d => (
                    <div key={d.day} className="mb-4">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-1.5">{d.day}</div>
                      <div className="flex gap-2 flex-wrap">
                        {d.slots.map(s => {
                          const id = `${d.day} ${s}`;
                          const active = pickedSlot === id;
                          return (
                            <button
                              key={s}
                              onClick={() => setPickedSlot(id)}
                              className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${active ? 'bg-[#8B1F1F] text-white border-[#8B1F1F]' : 'bg-white border-slate-200 hover:border-[#8B1F1F]'}`}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <button
                    disabled={!pickedSlot}
                    onClick={async () => {
                      if (!pickedSlot || !token) return;
                      await track(token, 'visit_request', { slot: pickedSlot, property_id: property?.id, client_name: clientFirstName });
                      setSubmitted('visit');
                    }}
                    className="w-full bg-[#8B1F1F] text-white py-3 rounded-xl font-medium mt-2 disabled:opacity-40"
                  >
                    Confirmar visita
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Pregunta */}
      {showQuestion && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setShowQuestion(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-lg">💬 Hacer una pregunta</h3>
              <button onClick={() => setShowQuestion(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4 space-y-3">
              {submitted === 'question' ? (
                <div className="py-6 text-center">
                  <div className="text-5xl mb-3">✅</div>
                  <h4 className="font-semibold text-lg">¡Mensaje enviado!</h4>
                  <p className="text-sm text-slate-600 mt-1">{agentFirstName} te contesta por WhatsApp.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600">Tu pregunta le llega a {agentFirstName} y te contesta por WhatsApp.</p>
                  <textarea
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    rows={4}
                    placeholder="ej: ¿Tiene cochera incluida? ¿Acepta financiación parcial?"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                  <button
                    disabled={!question.trim()}
                    onClick={async () => {
                      if (!question.trim() || !token) return;
                      await track(token, 'question_sent', { question: question.trim(), property_id: property?.id });
                      setSubmitted('question');
                    }}
                    className="w-full bg-[#8B1F1F] text-white py-3 rounded-xl font-medium disabled:opacity-40"
                  >
                    Enviar mensaje
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {showLightbox && photos.length > 0 && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center p-4" onClick={() => setShowLightbox(false)}>
          <button onClick={() => setShowLightbox(false)} className="absolute top-4 right-4 text-white text-2xl">✕</button>
          <img src={photos[activePhotoIdx]} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}

const Spec = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
  <div className="bg-slate-50 p-3 rounded-xl text-center">
    <div className="text-2xl mb-0.5">{icon}</div>
    <div className="text-base font-bold truncate">{value}</div>
    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
  </div>
);
