import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { matchesApi, type PendingMatch } from '../services/matches';
import { supabase } from '../services/supabase';
import QualityBadge from '../components/ui/QualityBadge';
import { ChannelIcon } from '../components/ui/ChannelIcon';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface PropertyGroup {
  property_id: string;
  property_address: string | null;
  property_barrio: string | null;
  property_price: number | null;
  property_rooms: number | null;
  matches: PendingMatch[];
}

export default function Matches() {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [matches, setMatches] = useState<PendingMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setMatches(await matchesApi.listAll());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const grouped: PropertyGroup[] = useMemo(() => {
    const map = new Map<string, PropertyGroup>();
    for (const m of matches) {
      const g = map.get(m.property_id) ?? {
        property_id: m.property_id,
        property_address: m.property_address,
        property_barrio: m.property_barrio,
        property_price: m.property_price,
        property_rooms: m.property_rooms,
        matches: [],
      };
      g.matches.push(m);
      map.set(m.property_id, g);
    }
    return Array.from(map.values()).sort((a, b) => b.matches.length - a.matches.length);
  }, [matches]);

  const dismissOne = async (m: PendingMatch) => {
    setBusy(m.id);
    try {
      await matchesApi.dismiss(m.id);
      setMatches(prev => prev.filter(x => x.id !== m.id));
    } finally { setBusy(null); }
  };

  const notifyOne = async (m: PendingMatch) => {
    setBusy(m.id);
    try {
      const propLink = `${window.location.origin}/properties?id=${m.property_id}`;
      const text = encodeURIComponent(buildTemplate(m));
      const phone = (m.contact_phone ?? '').replace(/\D/g, '');
      if (phone) {
        window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
      } else {
        await navigator.clipboard.writeText(buildTemplate(m));
        alert('No tiene WhatsApp registrado. Mensaje copiado al portapapeles para que lo mandes manualmente.');
      }
      await matchesApi.markNotified(m.id, currentUser.id);
      setMatches(prev => prev.filter(x => x.id !== m.id));
      void propLink;
    } finally { setBusy(null); }
  };

  const buildTemplate = (m: PendingMatch): string => {
    const name = (m.contact_name ?? '').split(' ')[0];
    const price = m.property_price ? `USD ${m.property_price.toLocaleString('es-AR')}` : '';
    const desc = [m.property_rooms ? `${m.property_rooms} ambientes` : null, m.property_barrio, price].filter(Boolean).join(' · ');
    return `Hola ${name || ''}! ${currentUser.name.split(' ')[0]} de Turdo Inmobiliaria. Te escribo porque entró una propiedad que matchea con lo que buscabas:\n\n${m.property_address ?? '?'}\n${desc}\n\n¿Querés que te pase fotos y plano completo?`;
  };

  if (currentUser.role !== 'admin') {
    return (
      <div className="p-6">
        <div className="bg-white border border-border rounded-2xl p-4 text-sm text-muted">
          Esta sección es solo para administradores.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Matches automáticos</h1>
        <p className="text-muted text-sm mt-0.5">
          La IA cruza propiedades disponibles con leads que ya pidieron algo similar (zona, ambientes, presupuesto).
          {matches.length > 0 && ` ${matches.length} matches pendientes en ${grouped.length} propiedades.`}
        </p>
      </div>

      <div className="bg-violet-50 border border-violet-200 text-violet-900 rounded-xl p-3 text-sm">
        💡 <strong>Cómo funciona:</strong> cada vez que cargás una propiedad o un lead nos cuenta lo que busca,
        el sistema los cruza automáticamente. Acá ves los matches con score ≥ 50/100. Tocá "Avisar"
        para abrir WhatsApp con un mensaje pre-armado, o "Descartar" si el lead ya no está interesado.
      </div>

      {loading ? (
        <Skeleton />
      ) : grouped.length === 0 ? (
        <Empty />
      ) : (
        grouped.map(g => (
          <PropertyCard
            key={g.property_id}
            group={g}
            navigate={navigate}
            onNotify={notifyOne}
            onDismiss={dismissOne}
            busy={busy}
          />
        ))
      )}
    </div>
  );
}

const PropertyCard = ({ group, navigate, onNotify, onDismiss, busy }: {
  group: PropertyGroup;
  navigate: ReturnType<typeof useNavigate>;
  onNotify: (m: PendingMatch) => Promise<void>;
  onDismiss: (m: PendingMatch) => Promise<void>;
  busy: string | null;
}) => {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-bg-soft text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-[#0F172A] truncate">{group.property_address ?? 'Propiedad'}</span>
            <span className="text-xs bg-violet-100 text-violet-800 px-2 py-0.5 rounded-full font-semibold">
              {group.matches.length} {group.matches.length === 1 ? 'match' : 'matches'}
            </span>
          </div>
          <div className="text-xs text-muted mt-0.5">
            {[group.property_barrio, group.property_rooms ? `${group.property_rooms} amb` : null,
              group.property_price ? `USD ${group.property_price.toLocaleString('es-AR')}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span className="text-muted text-lg">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {group.matches.map(m => (
            <div key={m.id} className="p-3 md:p-4 flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                <ScoreBadge score={m.score} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => navigate(`/inbox?lead=${m.contact_id}`)}
                    className="text-sm font-medium text-[#0F172A] hover:text-crimson hover:underline truncate"
                  >
                    {m.contact_name ?? 'Sin nombre'}
                  </button>
                  <ChannelIcon channel={m.contact_channel as 'whatsapp'} size="sm" />
                  <QualityBadge lead={{ quality_label: m.quality_label, quality_score: null, quality_reason: null }} size="sm" />
                  <span className="text-[10px] text-muted">
                    · {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: es })}
                  </span>
                </div>
                <div className="text-xs text-muted mt-1">
                  {m.reasons.map((r, i) => (
                    <span key={i} className="inline-block bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded mr-1 mb-1">
                      ✓ {r}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <button
                  onClick={() => onNotify(m)}
                  disabled={busy === m.id}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 whitespace-nowrap"
                >
                  💬 Avisar
                </button>
                <button
                  onClick={() => onDismiss(m)}
                  disabled={busy === m.id}
                  className="text-xs text-muted hover:text-red-600 px-2"
                >
                  Descartar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ScoreBadge = ({ score }: { score: number }) => {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 65 ? 'bg-amber-500' : 'bg-slate-400';
  return (
    <div className={`${color} text-white rounded-full w-10 h-10 flex items-center justify-center text-sm font-bold tabular-nums`}>
      {score}
    </div>
  );
};

const Skeleton = () => (
  <div className="space-y-3">
    {[0, 1, 2].map(i => <div key={i} className="skeleton h-24" />)}
  </div>
);

const Empty = () => (
  <div className="bg-white border border-dashed border-border rounded-2xl p-8 text-center">
    <div className="text-5xl mb-2">🔍</div>
    <h3 className="text-base font-semibold text-[#0F172A]">No hay matches pendientes</h3>
    <p className="text-sm text-muted mt-1 max-w-md mx-auto">
      Cuando cargues una propiedad nueva o un lead nos diga lo que busca, el sistema cruza automáticamente y aparecen acá.
    </p>
  </div>
);

void supabase;
