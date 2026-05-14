import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import {
  AMENITIES_OPTIONS,
  PROPERTY_TYPE_LABELS,
  OPERATION_LABELS,
  CONDITION_LABELS,
} from '../services/properties';
import type { DBProperty, DBPropertyPhoto } from '../services/properties';

const WHATSAPP_NUMBER = '5492235252984';

const fmt = (price: number | null, currency: string | null) => {
  if (!price) return '—';
  return `${currency ?? 'USD'} ${price.toLocaleString('es-AR')}`;
};

interface PublicProperty extends DBProperty {
  photos: DBPropertyPhoto[];
}

export default function PropertyPublic() {
  const { slug } = useParams<{ slug: string }>();
  const [prop, setProp] = useState<PublicProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      try {
        const { data: p, error } = await supabase
          .from('properties')
          .select('*')
          .eq('slug', slug)
          .eq('is_published', true)
          .maybeSingle();
        if (error || !p) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const { data: photos } = await supabase
          .from('property_photos')
          .select('*')
          .eq('property_id', p.id)
          .order('order_index', { ascending: true });
        setProp({ ...(p as DBProperty), photos: (photos ?? []) as DBPropertyPhoto[], amenities: (p as DBProperty).amenities ?? [] });
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-muted text-sm animate-pulse">Cargando propiedad...</div>
      </div>
    );
  }

  if (notFound || !prop) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4 opacity-20">🏠</div>
          <h1 className="text-xl font-bold text-[#0F172A]">Propiedad no encontrada</h1>
          <p className="text-muted text-sm mt-2">Esta propiedad no está disponible o fue retirada. Contactanos para ver opciones similares.</p>
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=Hola%20Turdo,%20busco%20propiedades%20disponibles%20en%20Mar%20del%20Plata`}
            target="_blank"
            rel="noopener"
            className="inline-block mt-6 px-5 py-2.5 bg-crimson text-white rounded-xl text-sm font-medium hover:bg-crimson-bright"
          >
            Contactanos por WhatsApp
          </a>
        </div>
      </div>
    );
  }

  const photos = prop.photos.length > 0 ? prop.photos : (prop.cover_photo_url ? [{ url: prop.cover_photo_url, id: 'cover' } as DBPropertyPhoto] : []);
  const cover = photos[activePhoto] ?? photos[0];

  const waMessage = `Hola Turdo, me interesa la propiedad ${prop.internal_code} en ${prop.address ?? prop.barrio}.`;
  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waMessage)}`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-border sticky top-0 z-10 backdrop-blur bg-white/95">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-crimson to-crimson-bright flex items-center justify-center text-white font-bold text-sm">
              T
            </div>
            <span className="font-bold text-[#0F172A]">Turdo Estudio Inmobiliario</span>
          </div>
          <a href={waUrl} target="_blank" rel="noopener" className="text-xs sm:text-sm px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700">
            📱 Consultar
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Hero: foto + datos clave */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Galería */}
          <div className="lg:col-span-2 space-y-2">
            <div
              onClick={() => cover && setLightbox(true)}
              className="bg-gray-100 rounded-2xl overflow-hidden aspect-[4/3] cursor-pointer relative group"
            >
              {cover ? (
                <img src={cover.url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-7xl opacity-20">🏠</div>
              )}
              {cover && (
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <span className="bg-white/90 text-[#0F172A] text-sm px-3 py-1.5 rounded-lg font-medium">🔍 Ampliar</span>
                </div>
              )}
            </div>
            {photos.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {photos.map((ph, i) => (
                  <button
                    key={ph.id}
                    onClick={() => setActivePhoto(i)}
                    className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                      i === activePhoto ? 'border-crimson' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img src={ph.url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info principal */}
          <aside className="bg-white border border-border rounded-2xl p-5 space-y-4 h-fit">
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs font-semibold px-2 py-1 rounded-md bg-crimson text-white">{OPERATION_LABELS[prop.operation_type]}</span>
              <span className="text-xs font-semibold px-2 py-1 rounded-md bg-gray-100 text-gray-700">{PROPERTY_TYPE_LABELS[prop.property_type]}</span>
              <span className="text-xs font-medium px-2 py-1 rounded-md bg-blue-50 text-blue-700 font-mono">{prop.internal_code}</span>
            </div>

            <div>
              <h1 className="text-xl font-bold text-[#0F172A] leading-tight">{prop.address ?? '—'}</h1>
              <p className="text-muted text-sm mt-0.5">{[prop.barrio, prop.city].filter(Boolean).join(' · ')}</p>
            </div>

            <div>
              <div className="text-3xl font-bold text-crimson-bright">{fmt(prop.list_price_usd, prop.price_currency)}</div>
              {prop.expenses_ars && (
                <div className="text-xs text-muted mt-0.5">Expensas ARS {prop.expenses_ars.toLocaleString('es-AR')}/mes</div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
              {prop.rooms != null && <Stat label="Ambientes" value={prop.rooms} />}
              {prop.bedrooms != null && <Stat label="Dormitorios" value={prop.bedrooms} />}
              {prop.bathrooms != null && <Stat label="Baños" value={prop.bathrooms} />}
              {prop.garage != null && prop.garage > 0 && <Stat label="Cocheras" value={prop.garage} />}
              {prop.surface_m2 != null && <Stat label="Sup. cubierta" value={`${prop.surface_m2} m²`} />}
              {prop.surface_total_m2 != null && <Stat label="Sup. total" value={`${prop.surface_total_m2} m²`} />}
            </div>

            <a
              href={waUrl}
              target="_blank"
              rel="noopener"
              className="block w-full text-center py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors"
            >
              📱 Consultar por WhatsApp
            </a>
          </aside>
        </div>

        {/* Descripción */}
        {prop.description && (
          <section className="bg-white border border-border rounded-2xl p-5">
            <h2 className="text-lg font-bold text-[#0F172A] mb-3">Descripción</h2>
            <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">{prop.description}</p>
          </section>
        )}

        {/* Detalles */}
        <section className="bg-white border border-border rounded-2xl p-5">
          <h2 className="text-lg font-bold text-[#0F172A] mb-3">Detalles</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <Detail label="Condición" value={CONDITION_LABELS[prop.condition]} />
            {prop.age_years != null && <Detail label="Antigüedad" value={`${prop.age_years} años`} />}
            {prop.orientation && <Detail label="Orientación" value={prop.orientation} />}
            {prop.floor && <Detail label="Piso" value={prop.floor + (prop.apartment_letter ? ' ' + prop.apartment_letter : '')} />}
            <Detail label="Ciudad" value={`${prop.city}, ${prop.province}`} />
          </div>
        </section>

        {/* Amenities */}
        {prop.amenities && prop.amenities.length > 0 && (
          <section className="bg-white border border-border rounded-2xl p-5">
            <h2 className="text-lg font-bold text-[#0F172A] mb-3">Amenities</h2>
            <div className="flex flex-wrap gap-2">
              {prop.amenities.map(a => {
                const opt = AMENITIES_OPTIONS.find(o => o.key === a);
                if (!opt) return null;
                return (
                  <span key={a} className="text-xs px-2.5 py-1 bg-bg-input rounded-full text-gray-700">
                    {opt.icon} {opt.label}
                  </span>
                );
              })}
            </div>
          </section>
        )}

        {/* Video */}
        {prop.video_url && (
          <section className="bg-white border border-border rounded-2xl p-5">
            <h2 className="text-lg font-bold text-[#0F172A] mb-3">Video / Tour</h2>
            <a href={prop.video_url} target="_blank" rel="noopener" className="text-crimson-bright hover:underline text-sm">
              Ver video →
            </a>
          </section>
        )}

        {/* Footer */}
        <footer className="text-center py-8 text-xs text-muted">
          <p>Turdo Estudio Inmobiliario · Mar del Plata</p>
          <p className="mt-1">2 sucursales · Más de 15 años en el mercado</p>
        </footer>
      </main>

      {/* Lightbox */}
      {lightbox && cover && (
        <div
          onClick={() => setLightbox(false)}
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img src={cover.url} alt="" className="max-w-full max-h-full object-contain rounded" loading="lazy" decoding="async" />
          <button className="absolute top-4 right-4 text-white text-2xl">×</button>
        </div>
      )}
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <div className="bg-bg-input rounded-lg px-3 py-2">
    <div className="text-[10px] text-muted uppercase tracking-wider">{label}</div>
    <div className="text-sm font-semibold text-[#0F172A]">{value}</div>
  </div>
);

const Detail = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <div className="text-xs text-muted">{label}</div>
    <div className="text-gray-700 font-medium">{value}</div>
  </div>
);
