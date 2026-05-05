// MOCKUP del mini-portal del cliente. Datos hardcoded para mostrar cómo se vería.
// Ruta pública (sin login). En la versión real, vendrá de turdogroup.com.ar/c/:token

import { useState } from 'react';

// Datos del depto Brown 2500 (Tokko ID 7929519) para que el mockup sea realista
const property = {
  code: 'TURDO-2563',
  title: 'Departamento reciclado en Plaza Mitre',
  address: 'Brown 2506, Piso 1°, Depto E',
  barrio: 'Plaza Mitre · Mar del Plata',
  price: 134900,
  rooms: 3,
  bedrooms: 2,
  bathrooms: 1,
  surface: 88,
  status: 'A estrenar (reciclado)',
  features: ['Balcón al frente', 'Ascensor', 'Mascotas permitidas', 'Alarma', 'Servicio de mantenimiento', 'Gas natural', 'Cable / Internet'],
  description: 'Departamento totalmente reciclado en Plaza Mitre. Todos los ambientes al frente con muy buena luz natural. Edificio con servicio de mantenimiento.',
  photos: [
    'https://static.tokkobroker.com/pictures/7929519_55813994489998994373341671930889036690082641479527733446767859190808873009436.jpg',
    'https://static.tokkobroker.com/pictures/7929519_99639524236541695228613935920823967117986503531258025992429676651273318395981.jpg',
    'https://static.tokkobroker.com/pictures/7929519_12358524185361720607051390804563225868354475889734229656606247757928269718311.jpg',
    'https://static.tokkobroker.com/pictures/7929519_11494413364657034573917726015057932970015165326134127332466983561578613798981.jpg',
    'https://static.tokkobroker.com/pictures/7929519_39691029395243815737053920508961207364985747931426128387300439506603806523999.jpg',
  ],
};

const agent = {
  name: 'Leticia Turdo',
  role: 'Asesora · Dueña de Turdo',
  phone: '5492235252984',
  whatsappUrl: 'https://api.whatsapp.com/send?phone=5492235252984&text=Hola%20Leticia!%20Vi%20el%20depto%20de%20Brown%202500%20que%20me%20mandaste',
};

const clientName = 'Juan';

const TIME_SLOTS = [
  { day: 'Mañana jueves 7/05', slots: ['10:00', '11:30', '16:00'] },
  { day: 'Viernes 8/05', slots: ['10:30', '14:00', '17:30'] },
  { day: 'Sábado 9/05', slots: ['10:00', '11:00'] },
];

export default function ClientPortalPreview() {
  const [activePhoto, setActivePhoto] = useState(0);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [pickedSlot, setPickedSlot] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-white text-[#0F172A]">
      {/* Mockup banner */}
      <div className="bg-amber-100 text-amber-900 text-center text-xs py-1.5 px-3 border-b border-amber-200">
        🎨 PREVIEW · Así se vería el portal del cliente. Datos de ejemplo del depto Brown 2500.
      </div>

      {/* Header con branding Turdo */}
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

      {/* Greeting personal */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-3xl font-bold">Hola {clientName} 👋</h1>
        <p className="text-slate-600 text-sm mt-1.5 leading-relaxed">
          Soy Leticia. Te preparé este resumen con la propiedad que charlamos. Mirá las fotos, agendá una visita o escribime cualquier duda.
        </p>
      </div>

      {/* Hero foto + precio */}
      <div className="max-w-2xl mx-auto px-4">
        <div className="relative cursor-pointer rounded-2xl overflow-hidden" onClick={() => setShowLightbox(true)}>
          <img src={property.photos[activePhoto]} alt={property.title} className="w-full aspect-[16/10] object-cover" />
          <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full backdrop-blur-sm">
            {activePhoto + 1} / {property.photos.length} · ver galería
          </div>
        </div>

        {/* Thumbnails */}
        <div className="grid grid-cols-5 gap-2 mt-2">
          {property.photos.map((p, i) => (
            <button
              key={i}
              onClick={() => setActivePhoto(i)}
              className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${i === activePhoto ? 'border-[#8B1F1F]' : 'border-transparent opacity-70'}`}
            >
              <img src={p} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>

        {/* Title + price */}
        <div className="mt-5 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold leading-tight">{property.title}</h2>
            <p className="text-sm text-slate-600 mt-1">📍 {property.address}</p>
            <p className="text-xs text-slate-500">{property.barrio} · {property.status}</p>
          </div>
          <div className="bg-[#8B1F1F] text-white px-4 py-3 rounded-xl text-right">
            <div className="text-[10px] opacity-80 uppercase tracking-wider">Precio</div>
            <div className="text-xl font-bold">USD {property.price.toLocaleString('es-AR')}</div>
          </div>
        </div>
      </div>

      {/* Specs grid */}
      <div className="max-w-2xl mx-auto px-4 mt-5">
        <div className="grid grid-cols-4 gap-2">
          <Spec icon="🏠" label="Ambientes" value={String(property.rooms)} />
          <Spec icon="🛏️" label="Dormitorios" value={String(property.bedrooms)} />
          <Spec icon="🚿" label="Baños" value={String(property.bathrooms)} />
          <Spec icon="📐" label="m² cub." value={String(property.surface)} />
        </div>
      </div>

      {/* Description */}
      <div className="max-w-2xl mx-auto px-4 mt-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">Sobre la propiedad</h3>
        <p className="text-sm text-slate-700 leading-relaxed">{property.description}</p>
      </div>

      {/* Features */}
      <div className="max-w-2xl mx-auto px-4 mt-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">Características destacadas</h3>
        <div className="flex flex-wrap gap-2">
          {property.features.map(f => (
            <span key={f} className="text-xs bg-slate-100 px-3 py-1.5 rounded-full">✓ {f}</span>
          ))}
        </div>
      </div>

      {/* Map placeholder */}
      <div className="max-w-2xl mx-auto px-4 mt-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">Ubicación</h3>
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(property.address + ', Mar del Plata, Argentina')}`}
          target="_blank"
          rel="noreferrer"
          className="block aspect-[16/9] bg-gradient-to-br from-emerald-50 via-blue-50 to-blue-100 rounded-2xl border border-slate-200 flex items-center justify-center text-center"
        >
          <div>
            <div className="text-4xl mb-1">📍</div>
            <div className="text-sm font-medium">{property.address}</div>
            <div className="text-xs text-slate-500 mt-0.5">Tocá para abrir en Google Maps</div>
          </div>
        </a>
      </div>

      {/* Plano y ficha PDF */}
      <div className="max-w-2xl mx-auto px-4 mt-6 grid grid-cols-2 gap-2">
        <a href="#" className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-3 text-center">
          <div className="text-2xl mb-1">📐</div>
          <div className="text-xs font-medium">Descargar plano</div>
          <div className="text-[10px] text-slate-500">PDF · 245 KB</div>
        </a>
        <a href="#" className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-3 text-center">
          <div className="text-2xl mb-1">📋</div>
          <div className="text-xs font-medium">Ficha completa</div>
          <div className="text-[10px] text-slate-500">PDF · 1.2 MB</div>
        </a>
      </div>

      {/* CTA principal sticky */}
      <div className="h-32" />
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <div className="max-w-2xl mx-auto grid grid-cols-2 gap-2">
          <button onClick={() => setShowVisitModal(true)} className="bg-[#8B1F1F] hover:bg-[#A52828] text-white py-3 rounded-xl font-medium text-sm transition-colors">
            📅 Agendar visita
          </button>
          <button onClick={() => setShowQuestionModal(true)} className="bg-white border-2 border-[#8B1F1F] text-[#8B1F1F] py-3 rounded-xl font-medium text-sm hover:bg-[#8B1F1F]/5 transition-colors">
            💬 Hacer una pregunta
          </button>
        </div>
      </div>

      {/* Tarjeta del vendedor */}
      <div className="max-w-2xl mx-auto px-4 mt-8 mb-32">
        <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-4 border border-slate-200">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Tu asesora</div>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[#8B1F1F] text-white flex items-center justify-center font-bold text-xl flex-shrink-0">
              L
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{agent.name}</div>
              <div className="text-xs text-slate-500">{agent.role}</div>
              <div className="text-[10px] text-slate-400 mt-1">+30 años en MdP · Plaza Mitre · Centro · Norte (Alem)</div>
            </div>
            <a
              href={agent.whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap"
            >
              WhatsApp
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 px-4 text-center">
        <div className="font-bold text-sm">Turdo Group</div>
        <div className="text-[10px] text-slate-500 mt-1">Real Estate · Mar del Plata · Sucursales Centro · Norte · Alem (próximamente)</div>
        <div className="text-[10px] text-slate-400 mt-3">
          Este link fue generado especialmente para vos. No lo compartas públicamente.
        </div>
      </footer>

      {/* Modal: Agendar visita */}
      {showVisitModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setShowVisitModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-lg">📅 Agendar visita</h3>
              <button onClick={() => setShowVisitModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-600 mb-3">Estos son los horarios libres de Leti. Tocá uno y te confirmo en el momento.</p>
              {TIME_SLOTS.map(d => (
                <div key={d.day} className="mb-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-1.5">{d.day}</div>
                  <div className="flex gap-2 flex-wrap">
                    {d.slots.map(s => {
                      const id = `${d.day}-${s}`;
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
                onClick={() => alert('✅ Mockup: en producción, esto crearía un evento en el calendario de Leti + push notification al CRM. La visita se reservaría sin que el cliente espere respuesta.')}
                className="w-full bg-[#8B1F1F] text-white py-3 rounded-xl font-medium mt-2 disabled:opacity-40"
              >
                Confirmar visita
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Hacer pregunta */}
      {showQuestionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setShowQuestionModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-lg">💬 Hacer una pregunta</h3>
              <button onClick={() => setShowQuestionModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-600">Tu pregunta le va a llegar a Leticia por el CRM de Turdo. Te contesta por WhatsApp o por acá.</p>
              <textarea rows={4} placeholder="ej: ¿Tiene cochera incluida? ¿Acepta financiación parcial?" className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" />
              <button
                onClick={() => alert('✅ Mockup: en producción, este mensaje aparecería en el chat del CRM como un nuevo mensaje del cliente, asignado a Leti, con notif push.')}
                className="w-full bg-[#8B1F1F] text-white py-3 rounded-xl font-medium"
              >
                Enviar mensaje
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {showLightbox && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center p-4" onClick={() => setShowLightbox(false)}>
          <button onClick={() => setShowLightbox(false)} className="absolute top-4 right-4 text-white text-2xl">✕</button>
          <img src={property.photos[activePhoto]} alt="" className="max-h-full max-w-full object-contain" />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {property.photos.map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); setActivePhoto(i); }} className={`w-2 h-2 rounded-full ${i === activePhoto ? 'bg-white' : 'bg-white/40'}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const Spec = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
  <div className="bg-slate-50 p-3 rounded-xl text-center">
    <div className="text-2xl mb-0.5">{icon}</div>
    <div className="text-lg font-bold">{value}</div>
    <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
  </div>
);
