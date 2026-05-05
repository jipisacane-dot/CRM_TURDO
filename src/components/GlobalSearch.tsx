import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../services/supabase';

interface Result {
  kind: 'lead' | 'property' | 'operation';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const { leads } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [propertyMatches, setPropertyMatches] = useState<Result[]>([]);
  const [operationMatches, setOperationMatches] = useState<Result[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Atajo de teclado: ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        return;
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setPropertyMatches([]);
      setOperationMatches([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Búsqueda en leads (cliente)
  const leadMatches: Result[] = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return leads
      .filter(l =>
        (l.name ?? '').toLowerCase().includes(q) ||
        (l.phone ?? '').toLowerCase().includes(q) ||
        (l.email ?? '').toLowerCase().includes(q) ||
        (l.propertyTitle ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map(l => ({
        kind: 'lead' as const,
        id: l.id,
        title: l.name ?? 'Sin nombre',
        subtitle: [l.phone, l.email, l.propertyTitle].filter(Boolean).join(' · ') || l.channel,
        href: `/inbox?lead=${l.id}`,
      }));
  }, [leads, query]);

  // Búsqueda en properties + operations (server)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setPropertyMatches([]);
      setOperationMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const ilikeQ = `%${q}%`;
        const [propsRes, opsRes] = await Promise.all([
          supabase.from('properties')
            .select('id, tokko_sku, address, barrio, list_price_usd, status')
            .or(`tokko_sku.ilike.${ilikeQ},address.ilike.${ilikeQ},barrio.ilike.${ilikeQ}`)
            .limit(6),
          // Operations: solo si la query parece status, número o "USD"
          /^\d/.test(q) || /^(pendiente|aprob|rech|venta|reserva|paid|paga)/i.test(q)
            ? supabase.from('operations')
                .select('id, precio_venta_usd, status, approval_status, fecha_boleto')
                .or(`status.ilike.${ilikeQ},approval_status.ilike.${ilikeQ}`)
                .limit(4)
            : Promise.resolve({ data: [] }),
        ]);
        if (cancelled) return;
        const props = (propsRes.data ?? []) as Array<{ id: string; tokko_sku: string | null; address: string | null; barrio: string | null; list_price_usd: number | null; status: string | null }>;
        const ops = ((opsRes as { data?: unknown }).data ?? []) as Array<{ id: string; precio_venta_usd: number | null; status: string | null; approval_status: string | null; fecha_boleto: string | null }>;
        setPropertyMatches(props.map(p => ({
          kind: 'property' as const,
          id: p.id,
          title: `${p.tokko_sku ?? 'Sin código'} — ${p.address ?? 'Sin dirección'}`,
          subtitle: [p.barrio, p.list_price_usd ? `USD ${Number(p.list_price_usd).toLocaleString('es-AR')}` : null, p.status].filter(Boolean).join(' · '),
          href: `/properties?id=${p.id}`,
        })));
        setOperationMatches(ops.map(o => ({
          kind: 'operation' as const,
          id: o.id,
          title: `Operación · ${o.approval_status ?? o.status ?? '—'}`,
          subtitle: [o.precio_venta_usd ? `USD ${Number(o.precio_venta_usd).toLocaleString('es-AR')}` : null, o.fecha_boleto].filter(Boolean).join(' · '),
          href: `/operations?id=${o.id}`,
        })));
      } catch {
        // si las consultas fallan, dejamos los resultados vacíos
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const allResults = useMemo(() =>
    [...leadMatches, ...propertyMatches, ...operationMatches],
    [leadMatches, propertyMatches, operationMatches]
  );

  const onPick = (r: Result) => {
    setOpen(false);
    navigate(r.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = allResults[activeIndex];
      if (r) onPick(r);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[10vh] p-4" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-3 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder="Buscar leads, propiedades, operaciones…"
            className="w-full px-3 py-2 text-base outline-none text-[#0F172A] placeholder:text-muted bg-transparent"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {!query.trim() && (
            <div className="p-8 text-center text-muted text-sm">
              Buscá por nombre, teléfono, email, código de propiedad…<br />
              <span className="text-xs mt-2 inline-block">⌘K para abrir · Esc para cerrar · ↑↓ para navegar · Enter para seleccionar</span>
            </div>
          )}

          {query.trim() && allResults.length === 0 && (
            <div className="p-8 text-center text-muted text-sm">Sin resultados para "{query}"</div>
          )}

          {leadMatches.length > 0 && (
            <Section title="Leads">
              {leadMatches.map((r, i) => (
                <ResultRow key={r.id} r={r} active={i === activeIndex} onClick={() => onPick(r)} />
              ))}
            </Section>
          )}

          {propertyMatches.length > 0 && (
            <Section title="Propiedades">
              {propertyMatches.map((r, i) => {
                const idx = leadMatches.length + i;
                return <ResultRow key={r.id} r={r} active={idx === activeIndex} onClick={() => onPick(r)} />;
              })}
            </Section>
          )}

          {operationMatches.length > 0 && (
            <Section title="Operaciones">
              {operationMatches.map((r, i) => {
                const idx = leadMatches.length + propertyMatches.length + i;
                return <ResultRow key={r.id} r={r} active={idx === activeIndex} onClick={() => onPick(r)} />;
              })}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="px-2 pt-2">
    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider px-3 py-1">{title}</div>
    <div>{children}</div>
  </div>
);

const ResultRow = ({ r, active, onClick }: { r: Result; active: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`w-full text-left px-3 py-2 rounded-lg flex items-start gap-3 transition-colors ${active ? 'bg-crimson/10' : 'hover:bg-bg-soft'}`}
  >
    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
      style={{ background: r.kind === 'lead' ? '#8B1F1F' : r.kind === 'property' ? '#0EA5E9' : '#10B981' }}>
      {r.kind === 'lead' ? 'L' : r.kind === 'property' ? 'P' : 'O'}
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-[#0F172A] truncate">{r.title}</div>
      {r.subtitle && <div className="text-xs text-muted truncate">{r.subtitle}</div>}
    </div>
  </button>
);
