// Página pública /t/:token — el cliente final ve su tasación profesional
// Estética editorial de lujo: marfil + crimson Turdo + champagne, tipografía
// serif Playfair para títulos, layout magazine-style.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const SERIF: React.CSSProperties = { fontFamily: "'Playfair Display', Georgia, serif" };

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

const VALUE_PROPS = [
  { i: '📸', t: 'Fotografía profesional', d: 'Sesión con cámara full-frame y luz natural' },
  { i: '🎬', t: 'Video tour & reels', d: 'Recorrido cinematográfico para redes' },
  { i: '📐', t: 'Plano arquitectónico', d: 'Levantamiento técnico con medidas reales' },
  { i: '✨', t: 'Amueblado virtual IA', d: 'Render fotorrealista para mostrar potencial' },
  { i: '⭐', t: 'Posición premier en portales', d: 'ZonaProp, ArgenProp, MercadoLibre destacado' },
  { i: '📲', t: 'Difusión en redes', d: 'Campaña Meta Ads segmentada por barrio' },
];

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
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-[#FAF7F2]">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#8B1F1F] border-t-transparent rounded-full animate-spin mx-auto" />
          <div className="text-[11px] tracking-[0.3em] uppercase text-[#6B6B6B] mt-4">Cargando tasación</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-[100dvh] flex items-center justify-center p-6 bg-[#FAF7F2]">
        <div className="text-center max-w-md">
          <div style={SERIF} className="text-6xl text-[#8B1F1F] mb-4">—</div>
          <h1 style={SERIF} className="text-2xl font-semibold text-[#1A1A1A]">Tasación no disponible</h1>
          <p className="text-sm text-[#6B6B6B] mt-3">{error}</p>
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
    <div className="appraisal-luxury h-[100dvh] overflow-y-auto bg-[#FAF7F2] text-[#1A1A1A]">
      {/* ── Top brand bar ─────────────────────────────────────────── */}
      <header className="bg-white border-b border-[#E8E2D8]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="34" height="34" viewBox="0 0 100 100" fill="none">
              <path d="M8 8 L92 8 L55 55 L8 8Z" fill="#8B1F1F"/>
              <path d="M8 8 L55 55 L8 92 Z" fill="#C9A961" opacity="0.6"/>
              <circle cx="65" cy="62" r="9" fill="#8B1F1F"/>
            </svg>
            <div>
              <div style={SERIF} className="font-semibold text-base leading-none">Turdo Group</div>
              <div className="text-[9px] tracking-[0.25em] text-[#C9A961] uppercase mt-1">Real Estate & Investments</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] tracking-[0.25em] uppercase text-[#6B6B6B]">Informe de tasación</div>
            <div style={SERIF} className="text-sm text-[#1A1A1A] mt-0.5 italic">{date}</div>
          </div>
        </div>
      </header>

      {/* ── HERO ──────────────────────────────────────────────────── */}
      {photos.length > 0 ? (
        <div className="relative h-[55vh] md:h-[70vh] overflow-hidden bg-[#1A1A1A]">
          <img src={photos[0].url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          {/* Doble overlay: gradient + scrim sólido inferior para garantizar contraste del título */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/20" />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent h-[55%]" />
          <div className="absolute bottom-0 left-0 right-0">
            <div
              className="max-w-5xl mx-auto px-6 py-10 md:py-14"
              style={{ textShadow: '0 2px 24px rgba(0,0,0,0.75)' }}
            >
              <div className="text-[#E8C97A] text-[10px] md:text-xs tracking-[0.35em] uppercase mb-4 font-semibold">
                Tasación profesional{a.barrio ? ` · ${a.barrio}` : ''}
              </div>
              <h1 style={{ ...SERIF, color: '#FFFFFF', textShadow: '0 2px 32px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.5)' }} className="text-3xl md:text-5xl lg:text-6xl font-semibold leading-[1.1]">
                {a.property_address}
              </h1>
              {clientFirstName && (
                <p style={{ ...SERIF, color: 'rgba(255,255,255,0.9)' }} className="mt-4 italic text-base md:text-lg">
                  Preparado para {clientFirstName}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-[#8B1F1F] via-[#7A1B1B] to-[#5C1414] text-white">
          <div className="max-w-5xl mx-auto px-6 py-14 md:py-24">
            <div className="text-[#C9A961] text-[10px] md:text-xs tracking-[0.35em] uppercase mb-4">
              Tasación profesional{a.barrio ? ` · ${a.barrio}` : ''}
            </div>
            <h1 style={SERIF} className="text-3xl md:text-5xl lg:text-6xl font-semibold leading-[1.1]">
              {a.property_address}
            </h1>
            {clientFirstName && (
              <p style={SERIF} className="text-white/80 mt-4 italic text-base md:text-lg">
                Preparado para {clientFirstName}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── CONTENT ───────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-12 md:py-16 space-y-14 md:space-y-20">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 border-y border-[#E8E2D8]">
          <Stat label="Ambientes" value={a.rooms ? String(a.rooms) : '—'} />
          <Stat label="Dormitorios" value={a.bedrooms ? String(a.bedrooms) : '—'} />
          <Stat label="Superficie" value={a.surface_m2 ? `${a.surface_m2}` : '—'} unit="m²" />
          <Stat label="Antigüedad" value={a.age_years !== null && a.age_years !== undefined ? String(a.age_years) : '—'} unit={a.age_years ? 'años' : ''} />
        </div>

        {/* PRECIO */}
        <div className="text-center py-6 md:py-10">
          <div className="text-[#C9A961] text-[10px] md:text-xs tracking-[0.35em] uppercase mb-5">
            Valor estimado de mercado
          </div>
          <div style={SERIF} className="text-[#8B1F1F] text-3xl sm:text-4xl md:text-6xl font-semibold tabular-nums leading-tight">
            {fmt(a.suggested_price_low_usd)}
            <span className="text-[#C9A961] mx-2 md:mx-4 font-light">—</span>
            <br className="md:hidden" />
            {fmt(a.suggested_price_high_usd)}
          </div>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-2 mt-7 text-sm text-[#6B6B6B]">
            {ppm > 0 && (
              <div>
                <span className="text-[10px] tracking-[0.25em] uppercase">USD/m²</span>
                <span style={SERIF} className="ml-2 text-base text-[#1A1A1A] tabular-nums font-semibold">
                  {ppm.toLocaleString('es-AR')}
                </span>
              </div>
            )}
            {a.estimated_sale_days > 0 && (
              <div>
                <span className="text-[10px] tracking-[0.25em] uppercase">Venta estimada</span>
                <span style={SERIF} className="ml-2 text-base text-[#1A1A1A] font-semibold">
                  {a.estimated_sale_days} días
                </span>
              </div>
            )}
          </div>
        </div>

        {/* GALERÍA */}
        {photos.length > 1 && (
          <div>
            <SectionTitle eyebrow="La propiedad" title="Galería" />
            <div className="grid grid-cols-3 gap-2 md:gap-3 mt-8">
              {photos.slice(0, 6).map((p, i) => (
                <button
                  key={i}
                  onClick={() => { setActivePhoto(i); setLightbox(true); }}
                  className={`relative overflow-hidden bg-[#E8E2D8] hover:opacity-90 transition-opacity ${i === 0 && photos.length >= 3 ? 'col-span-3 aspect-[16/8]' : 'aspect-square'}`}
                >
                  <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* AMENITIES */}
        {(a.amenities && a.amenities.length > 0) && (
          <div>
            <SectionTitle eyebrow="Características" title="Servicios y amenities" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-10 gap-y-3 mt-8">
              {a.amenities.map(am => (
                <div key={am} className="flex items-center gap-3 text-[15px]">
                  <span className="w-1 h-1 rounded-full bg-[#C9A961] flex-shrink-0" />
                  <span>{AMENITY_LABEL[am] ?? am}</span>
                </div>
              ))}
              {a.has_view && a.view_type && (
                <div className="flex items-center gap-3 text-[15px]">
                  <span className="w-1 h-1 rounded-full bg-[#C9A961] flex-shrink-0" />
                  <span>Vista {a.view_type.replace(/_/g, ' ')}</span>
                </div>
              )}
              {a.floor_number != null && (
                <div className="flex items-center gap-3 text-[15px]">
                  <span className="w-1 h-1 rounded-full bg-[#C9A961] flex-shrink-0" />
                  <span>Piso {a.floor_number}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ANÁLISIS — sans-serif limpio, sin drop cap (mejor para texto técnico con números) */}
        {a.ai_reasoning && (
          <div>
            <SectionTitle eyebrow="Razonamiento" title="Análisis del precio" />
            <div className="mt-8 max-w-[680px]">
              <p className="text-[15px] md:text-base leading-[1.75] text-[#1A1A1A] whitespace-pre-line">
                {a.ai_reasoning}
              </p>
            </div>
          </div>
        )}

        {/* MERCADO */}
        {a.market_summary && (
          <div className="bg-[#F1ECE3] px-6 md:px-12 py-10 md:py-12 border-l-2 border-[#C9A961]">
            <div className="text-[#C9A961] text-[10px] tracking-[0.35em] uppercase mb-4">
              Contexto del mercado
            </div>
            <p style={SERIF} className="text-[16px] md:text-[18px] leading-[1.7] text-[#1A1A1A] italic">
              "{a.market_summary}"
            </p>
          </div>
        )}

        {/* COMPARABLES */}
        {a.comparables && a.comparables.length > 0 && (
          <div>
            <SectionTitle eyebrow={`${a.comparables.length} propiedades`} title="Comparables del mercado" />
            <div className="mt-8 overflow-x-auto -mx-6 md:mx-0">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="text-left text-[10px] tracking-[0.2em] uppercase text-[#6B6B6B] border-b-2 border-[#1A1A1A]">
                    <th className="px-4 py-3 font-medium">Dirección</th>
                    <th className="px-4 py-3 font-medium text-right">Precio</th>
                    <th className="px-4 py-3 font-medium text-right">m²</th>
                    <th className="px-4 py-3 font-medium text-right">USD/m²</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8E2D8]">
                  {a.comparables.map((c, i) => (
                    <tr key={i} className="hover:bg-[#F1ECE3]/50 transition-colors">
                      <td className="px-4 py-4">
                        <div className="font-medium">{c.address}</div>
                        {c.barrio && <div className="text-xs text-[#6B6B6B] mt-0.5">{c.barrio}</div>}
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums">
                        <span style={SERIF} className="font-semibold text-[#8B1F1F] text-[15px]">{fmt(c.price_usd)}</span>
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums">{c.m2}</td>
                      <td className="px-4 py-4 text-right tabular-nums text-[#6B6B6B]">
                        {c.m2 ? Math.round(c.price_usd / c.m2).toLocaleString('es-AR') : '—'}
                      </td>
                      <td className="px-4 py-4 text-[#6B6B6B] text-xs">{c.state ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* RECOMENDACIONES — prepende 2 bullets de precio calculados dinámicamente */}
        {(() => {
          const high = a.suggested_price_high_usd;
          const low = a.suggested_price_low_usd;
          const cierre = Math.round((low + high) / 2 / 1000) * 1000;
          const fromOffer = Math.round((low * 0.95) / 1000) * 1000;
          // Filtrar recomendaciones legacy que mencionen montos USD (de tasaciones viejas)
          const filteredRecs = (a.recommendations ?? []).filter(r => !/USD\s*[\d.,]+|\$\s*[\d.,]+\s*(K|mil)/i.test(r));
          const priceRecs = [
            `Publicar en USD ${high.toLocaleString('es-AR')} con margen para negociar cierre en USD ${cierre.toLocaleString('es-AR')}`,
            `Aceptar ofertas serias desde USD ${fromOffer.toLocaleString('es-AR')} si hay financiación confirmada o cierre rápido`,
          ];
          const allRecs = [...priceRecs, ...filteredRecs];
          if (allRecs.length === 0) return null;
          return (
            <div>
              <SectionTitle eyebrow="Estrategia" title="Recomendaciones para maximizar la venta" />
              <ul className="mt-8 space-y-5">
                {allRecs.map((r, i) => (
                  <li key={i} className="flex gap-5 items-start">
                    <div
                      style={SERIF}
                      className="flex-shrink-0 w-9 h-9 rounded-full border border-[#C9A961] flex items-center justify-center text-[#C9A961] font-semibold"
                    >
                      {i + 1}
                    </div>
                    <p className="text-[15px] md:text-base leading-[1.7] text-[#1A1A1A] flex-1 pt-1.5">{r}</p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        {/* PROPUESTA DE VALOR */}
        <div>
          <SectionTitle eyebrow="Servicio Turdo" title="Cómo trabajamos tu propiedad" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-8 mt-10">
            {VALUE_PROPS.map((p, i) => (
              <div key={i} className="border-t border-[#1A1A1A] pt-5">
                <div className="text-2xl mb-3">{p.i}</div>
                <h4 style={SERIF} className="font-semibold text-base text-[#1A1A1A] mb-1.5">{p.t}</h4>
                <p className="text-sm text-[#6B6B6B] leading-relaxed">{p.d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ASESOR */}
        {agent && (
          <div className="bg-[#1A1A1A] text-white overflow-hidden">
            <div className="grid md:grid-cols-2">
              <div className="p-8 md:p-12 flex flex-col justify-center">
                <div className="text-[#C9A961] text-[10px] tracking-[0.35em] uppercase mb-4">
                  Tu asesor inmobiliario
                </div>
                <div className="flex items-center gap-5 mb-5">
                  {agent.avatar_url ? (
                    <img src={agent.avatar_url} className="w-20 h-20 rounded-full object-cover flex-shrink-0 border-2 border-[#C9A961]" alt="" loading="lazy" decoding="async" />
                  ) : (
                    <div
                      style={SERIF}
                      className="w-20 h-20 rounded-full bg-[#8B1F1F] text-white flex items-center justify-center font-semibold text-3xl flex-shrink-0 border-2 border-[#C9A961]"
                    >
                      {agent.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 style={SERIF} className="text-2xl md:text-3xl font-semibold leading-tight">{agent.name}</h3>
                    {agent.branch && <p className="text-white/60 text-sm mt-1">{agent.branch}</p>}
                  </div>
                </div>
                <div className="space-y-1 text-sm text-white/70">
                  {agent.phone && <div>{agent.phone}</div>}
                  {agent.email && <div>{agent.email}</div>}
                </div>
              </div>
              <div className="p-8 md:p-12 bg-gradient-to-br from-[#8B1F1F] to-[#5C1414] flex flex-col justify-center text-center">
                <div style={SERIF} className="text-2xl md:text-3xl font-semibold mb-2 leading-tight">
                  ¿Avanzamos?
                </div>
                <p className="text-white/80 text-sm mb-6 max-w-xs mx-auto">
                  Coordinemos una reunión para definir la estrategia de venta de tu propiedad.
                </p>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block bg-white text-[#8B1F1F] px-8 py-4 font-semibold tracking-wide text-sm hover:bg-[#FAF7F2] transition-colors"
                >
                  Hablar por WhatsApp →
                </a>
              </div>
            </div>
          </div>
        )}

        {/* DISCLAIMER */}
        <p className="text-[10px] text-[#6B6B6B] text-center max-w-2xl mx-auto leading-relaxed pt-4">
          Estimación referencial basada en análisis del mercado actual al {date}. No constituye una tasación oficial registrada.
          La operación final puede variar según condiciones específicas de venta.
        </p>
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <footer className="bg-white border-t border-[#E8E2D8] py-12 px-6 mt-12">
        <div className="max-w-5xl mx-auto text-center">
          <svg width="42" height="42" viewBox="0 0 100 100" fill="none" className="mx-auto mb-3">
            <path d="M8 8 L92 8 L55 55 L8 8Z" fill="#8B1F1F"/>
            <path d="M8 8 L55 55 L8 92 Z" fill="#C9A961" opacity="0.6"/>
            <circle cx="65" cy="62" r="9" fill="#8B1F1F"/>
          </svg>
          <div style={SERIF} className="text-xl font-semibold">Turdo Group</div>
          <div className="text-[10px] tracking-[0.35em] uppercase text-[#C9A961] mt-1.5">Real Estate & Investments</div>
          <div className="text-xs text-[#6B6B6B] mt-3">Mar del Plata, Argentina</div>
        </div>
      </footer>

      {/* ── LIGHTBOX ──────────────────────────────────────────────── */}
      {lightbox && photos.length > 0 && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
            className="absolute top-5 right-5 text-white text-3xl z-10 hover:text-[#C9A961] transition-colors"
          >
            ✕
          </button>
          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setActivePhoto(p => (p - 1 + photos.length) % photos.length); }}
                className="absolute left-5 top-1/2 -translate-y-1/2 text-white text-4xl z-10 hover:text-[#C9A961] transition-colors w-12 h-12 flex items-center justify-center"
              >
                ‹
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setActivePhoto(p => (p + 1) % photos.length); }}
                className="absolute right-5 top-1/2 -translate-y-1/2 text-white text-4xl z-10 hover:text-[#C9A961] transition-colors w-12 h-12 flex items-center justify-center"
              >
                ›
              </button>
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-white/70 text-xs tracking-[0.3em]">
                {activePhoto + 1} / {photos.length}
              </div>
            </>
          )}
          <img src={photos[activePhoto].url}
            alt=""
            loading="lazy"
            decoding="async"
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

const SectionTitle = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div>
    <div className="text-[#C9A961] text-[10px] tracking-[0.35em] uppercase mb-3">{eyebrow}</div>
    <h2 style={SERIF} className="text-2xl md:text-4xl font-semibold text-[#1A1A1A] leading-tight">{title}</h2>
  </div>
);

const Stat = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <div className="text-center py-6 md:py-8 px-3 border-r last:border-r-0 border-[#E8E2D8]">
    <div className="flex items-baseline justify-center gap-1.5">
      <span style={SERIF} className="text-3xl md:text-4xl font-semibold text-[#1A1A1A] tabular-nums">{value}</span>
      {unit && <span className="text-xs text-[#6B6B6B]">{unit}</span>}
    </div>
    <div className="text-[10px] tracking-[0.3em] uppercase text-[#6B6B6B] mt-2">{label}</div>
  </div>
);
