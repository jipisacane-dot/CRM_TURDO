// Página pública /t/:token — el cliente final ve su tasación profesional
// con branding Turdo + fotos del depto + análisis + precio sugerido.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface Appraisal {
  id: string;
  property_address: string;
  barrio: string | null;
  rooms: number | null;
  bedrooms: number | null;
  surface_m2: number | null;
  age_years: number | null;
  property_state: string | null;
  has_view: boolean | null;
  view_type: string | null;
  amenities: string[] | null;
  expenses_ars: number | null;
  floor_number: number | null;
  exposure: string | null;
  client_name: string | null;
  suggested_price_low_usd: number;
  suggested_price_high_usd: number;
  comparables: Array<{ address: string; barrio?: string; price_usd: number; m2: number; rooms?: number; state?: string }>;
  ai_reasoning: string;
  market_summary: string;
  recommendations: string[];
  estimated_sale_days: number;
  photos: Array<{ url: string; caption?: string }>;
  created_at: string;
}

interface Agent {
  name: string;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  branch: string | null;
}

const STATE_LABEL: Record<string, string> = {
  a_estrenar: 'A estrenar',
  reciclado: 'Reciclado a estrenar',
  usado_buen_estado: 'Usado, buen estado',
  usado_regular: 'Usado, regular',
};

const AMENITY_LABEL: Record<string, string> = {
  balcon: 'Balcón',
  ascensor: 'Ascensor',
  cochera: 'Cochera',
  amenities: 'Amenities',
  parrilla: 'Parrilla',
  piscina: 'Piscina',
  sum: 'SUM',
  alarma: 'Alarma',
  mascotas: 'Mascotas permitidas',
};

export default function AppraisalPublic() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ appraisal: Appraisal; agent: Agent | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePhoto, setActivePhoto] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!token) { setError('Link inválido'); setLoading(false); return; }
    fetch(`${SUPABASE_URL}/functions/v1/get-appraisal-public?token=${encodeURIComponent(token)}`, {
      headers: { 'apikey': SUPABASE_ANON_KEY },
    })
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `Status ${r.status}`);
        }
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError((e as Error).message); setLoading(false); });
  }, [token]);

  if (loading) {
    return <div className="min-h-[100dvh] flex items-center justify-center text-slate-500">Cargando…</div>;
  }

  if (error || !data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-3">😕</div>
          <h1 className="text-xl font-semibold text-slate-900">Tasación no disponible</h1>
          <p className="text-sm text-slate-500 mt-2 max-w-sm">{error}</p>
        </div>
      </div>
    );
  }

  const { appraisal: a, agent } = data;
  const clientFirstName = (a.client_name ?? '').split(' ')[0] || '';
  const photos = a.photos ?? [];
  const fmt = (n: number) => `USD ${n.toLocaleString('es-AR')}`;
  const ppm = a.surface_m2 ? Math.round((a.suggested_price_low_usd + a.suggested_price_high_usd) / 2 / a.surface_m2) : 0;
  const date = new Date(a.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  const agentPhoneDigits = (agent?.phone ?? '5492235252984').replace(/\D/g, '');
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${agentPhoneDigits}&text=Hola!%20Vi%20la%20tasaci%C3%B3n%20que%20me%20mandaste.%20Quiero%20avanzar.`;

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
      {/* Header crimson con logo */}
      <header className="bg-[#8B1F1F] text-white">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center justify-between">
          <div>
            <div className="font-bold text-lg leading-tight">Turdo Group</div>
            <div className="text-[10px] opacity-80 tracking-wider">REAL ESTATE & INVESTMENTS</div>
          </div>
          <div className="text-xs opacity-80 text-right">
            <div>Informe de tasación</div>
            <div className="text-[10px]">{date}</div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Greeting */}
        <div>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">
            {clientFirstName ? `Hola ${clientFirstName} 👋` : 'Tu tasación profesional'}
          </h1>
          <p className="text-slate-600 text-sm md:text-base mt-2 leading-relaxed">
            {agent?.name ? `Soy ${agent.name.split(' ')[0]}. ` : ''}
            Te preparé este informe con la tasación profesional de tu propiedad. Análisis del mercado, comparables actuales y precio sugerido.
          </p>
        </div>

        {/* Hero foto principal + galería */}
        {photos.length > 0 && (
          <div className="space-y-2">
            <div
              onClick={() => setLightbox(true)}
              className="relative rounded-2xl overflow-hidden cursor-pointer bg-slate-200"
            >
              <img src={photos[activePhoto].url} alt="" className="w-full aspect-[16/10] object-cover" />
              {photos.length > 1 && (
                <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full">
                  {activePhoto + 1} / {photos.length}
                </div>
              )}
            </div>
            {photos.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {photos.slice(0, 5).map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePhoto(i)}
                    className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${i === activePhoto ? 'border-[#8B1F1F]' : 'border-transparent opacity-60 hover:opacity-100'}`}
                  >
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Datos de la propiedad */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h2 className="text-xl font-bold leading-tight">{a.property_address}</h2>
          <p className="text-sm text-slate-600 mt-1">
            {[a.barrio, a.property_state ? STATE_LABEL[a.property_state] : null].filter(Boolean).join(' · ')}
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            <Spec icon="🏠" label="Ambientes" value={a.rooms ? String(a.rooms) : '—'} />
            <Spec icon="🛏️" label="Dormitorios" value={a.bedrooms ? String(a.bedrooms) : '—'} />
            <Spec icon="📐" label="m² cubiertos" value={a.surface_m2 ? String(a.surface_m2) : '—'} />
            <Spec icon="📅" label="Antigüedad" value={a.age_years !== null && a.age_years !== undefined ? `${a.age_years} años` : '—'} />
          </div>

          {(a.amenities && a.amenities.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {a.amenities.map(am => (
                <span key={am} className="text-xs bg-slate-100 px-2.5 py-1 rounded-full">
                  ✓ {AMENITY_LABEL[am] ?? am}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Hero del precio */}
        <div className="bg-gradient-to-br from-[#8B1F1F] to-[#A52828] rounded-2xl p-6 text-white">
          <div className="text-xs uppercase tracking-wider opacity-80 mb-1">Precio sugerido de publicación</div>
          <div className="text-3xl md:text-4xl font-bold tabular-nums">
            {fmt(a.suggested_price_low_usd)} — {fmt(a.suggested_price_high_usd)}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm opacity-90">
            {ppm > 0 && <span>≈ USD {ppm.toLocaleString('es-AR')}/m²</span>}
            {a.estimated_sale_days > 0 && <span>Tiempo estimado de venta: {a.estimated_sale_days} días</span>}
          </div>
        </div>

        {/* Análisis */}
        {a.ai_reasoning && (
          <Section title="Análisis del precio">
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{a.ai_reasoning}</p>
          </Section>
        )}

        {/* Mercado */}
        {a.market_summary && (
          <Section title="Contexto del mercado">
            <p className="text-sm text-slate-700 leading-relaxed">{a.market_summary}</p>
          </Section>
        )}

        {/* Comparables */}
        {a.comparables && a.comparables.length > 0 && (
          <Section title={`Propiedades comparables (${a.comparables.length})`}>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
                    <th className="px-2 py-2 font-medium">Dirección</th>
                    <th className="px-2 py-2 font-medium text-right">Precio</th>
                    <th className="px-2 py-2 font-medium text-right">m²</th>
                    <th className="px-2 py-2 font-medium text-right">Amb</th>
                    <th className="px-2 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {a.comparables.map((c, i) => (
                    <tr key={i}>
                      <td className="px-2 py-2 truncate max-w-[180px]">{c.address}</td>
                      <td className="px-2 py-2 text-right font-semibold text-[#8B1F1F] tabular-nums">{fmt(c.price_usd)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{c.m2}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{c.rooms ?? '—'}</td>
                      <td className="px-2 py-2 text-slate-500 text-xs">{c.state ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Recomendaciones */}
        {a.recommendations && a.recommendations.length > 0 && (
          <Section title="Recomendaciones para maximizar la venta">
            <ul className="space-y-2">
              {a.recommendations.map((r, i) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className="text-emerald-500 flex-shrink-0">✓</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Propuesta de valor — qué hace Turdo */}
        <Section title="Lo que hacemos para vender tu propiedad">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { i: '📸', t: 'Fotos profesionales' },
              { i: '🎬', t: 'Video tour + reels' },
              { i: '📐', t: 'Plano arquitectónico' },
              { i: '✨', t: 'Amueblado virtual con IA' },
              { i: '⭐', t: 'Premier en portales' },
              { i: '📲', t: 'Difusión en redes' },
            ].map((p, idx) => (
              <div key={idx} className="bg-slate-50 rounded-xl p-3 text-center">
                <div className="text-2xl mb-1">{p.i}</div>
                <div className="text-xs font-medium">{p.t}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* CTA al asesor */}
        {agent && (
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-5 border border-slate-200">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Tu asesor</div>
            <div className="flex items-center gap-3">
              {agent.avatar_url ? (
                <img src={agent.avatar_url} className="w-14 h-14 rounded-full object-cover flex-shrink-0" alt="" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-[#8B1F1F] text-white flex items-center justify-center font-bold text-xl flex-shrink-0">
                  {agent.name.charAt(0)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{agent.name}</div>
                {agent.branch && <div className="text-xs text-slate-500">{agent.branch}</div>}
                {agent.phone && <div className="text-xs text-slate-500 mt-0.5">{agent.phone}</div>}
              </div>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap"
              >
                💬 Avanzar
              </a>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-[10px] text-slate-400 text-center max-w-md mx-auto">
          Estimación referencial basada en análisis de mercado actual. No constituye una tasación oficial registrada.
          La operación final puede variar según condiciones específicas de venta.
        </p>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-8 py-6 px-4 text-center bg-white">
        <div className="font-bold text-sm">Turdo Group</div>
        <div className="text-[10px] text-slate-500 mt-1">Real Estate & Investments · Mar del Plata</div>
      </footer>

      {/* Lightbox */}
      {lightbox && photos.length > 0 && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
          <button onClick={() => setLightbox(false)} className="absolute top-4 right-4 text-white text-2xl z-10">✕</button>
          <img src={photos[activePhoto].url} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-5">
    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-3">{title}</h3>
    {children}
  </div>
);

const Spec = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
  <div className="bg-slate-50 rounded-xl p-3 text-center">
    <div className="text-xl mb-0.5">{icon}</div>
    <div className="text-base font-bold truncate">{value}</div>
    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
  </div>
);
