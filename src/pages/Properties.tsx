import { useState, useMemo } from 'react';
import { useTokkoProperties } from '../hooks/useTokkoProperties';
import type { CRMProperty } from '../services/tokko';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Modal } from '../components/ui/Modal';

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatPrice = (price: number, currency: string) => {
  if (!price) return '—';
  return currency === 'USD'
    ? `USD ${price.toLocaleString('es-AR')}`
    : `$ ${price.toLocaleString('es-AR')}`;
};

const statusCfg = {
  active:   { label: 'Activa',     color: 'bg-green-900/50 text-green-400' },
  reserved: { label: 'Reservada',  color: 'bg-yellow-900/50 text-yellow-400' },
  sold:     { label: 'Vendida',    color: 'bg-gray-700 text-gray-400' },
};

const opColor = {
  'Venta':             'bg-crimson text-white',
  'Alquiler':          'bg-blue-700 text-white',
  'Alquiler Temporal': 'bg-indigo-700 text-white',
};

// ── Property card ─────────────────────────────────────────────────────────────

const PropertyCard = ({ prop, onClick }: { prop: CRMProperty; onClick: () => void }) => {
  const st = statusCfg[prop.status];
  const opCls = opColor[prop.mainOperation as keyof typeof opColor] ?? 'bg-gray-700 text-white';

  return (
    <div
      onClick={onClick}
      className="bg-bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:border-crimson/50 transition-all group"
    >
      {/* Cover photo */}
      <div className="h-40 bg-gradient-to-br from-bg-input to-bg-hover flex items-center justify-center relative overflow-hidden">
        {prop.coverPhoto ? (
          <img src={prop.coverPhoto} alt={prop.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <span className="text-5xl opacity-20">🏠</span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Badges */}
        <div className="absolute top-3 left-3 flex gap-1.5">
          {prop.mainOperation && (
            <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${opCls}`}>{prop.mainOperation}</span>
          )}
        </div>
        <div className="absolute top-3 right-3">
          <span className={`text-xs font-medium px-2 py-1 rounded-lg ${st.color}`}>{st.label}</span>
        </div>

        {/* Price on photo */}
        <div className="absolute bottom-3 left-3">
          <span className="text-white font-bold text-lg drop-shadow-lg">
            {formatPrice(prop.mainPrice, prop.mainCurrency)}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="text-white font-semibold text-sm line-clamp-1 group-hover:text-crimson-bright transition-colors">{prop.title}</div>
        <div className="text-muted text-xs mt-0.5 truncate">📍 {prop.address}</div>
        {prop.location && <div className="text-muted text-xs truncate">{prop.location}</div>}

        <div className="flex flex-wrap gap-2 mt-3 text-xs text-muted">
          {prop.rooms > 0 && <span>🚪 {prop.rooms} amb.</span>}
          {prop.bedrooms > 0 && <span>🛏 {prop.bedrooms}</span>}
          {prop.bathrooms > 0 && <span>🚿 {prop.bathrooms}</span>}
          {prop.parking > 0 && <span>🚗 {prop.parking}</span>}
          {prop.roofedSurface && <span>📐 {prop.roofedSurface}m²</span>}
        </div>

        {prop.branch && (
          <div className="mt-2 text-xs text-muted border-t border-border pt-2">{prop.branch}</div>
        )}
        {prop.agent && (
          <div className="text-xs text-muted">Agente: {prop.agent}</div>
        )}
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Properties() {
  const { properties, loading, error, lastFetch, refetch } = useTokkoProperties();
  const [search, setSearch] = useState('');
  const [opFilter, setOpFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'reserved' | 'sold'>('active');
  const [selected, setSelected] = useState<CRMProperty | null>(null);

  const allTypes = useMemo(() => Array.from(new Set(properties.map(p => p.type))).sort(), [properties]);
  const allOps   = useMemo(() => Array.from(new Set(properties.map(p => p.mainOperation).filter(Boolean))).sort(), [properties]);

  const filtered = useMemo(() => properties
    .filter(p => statusFilter === 'all' || p.status === statusFilter)
    .filter(p => opFilter === 'all' || p.mainOperation === opFilter)
    .filter(p => typeFilter === 'all' || p.type === typeFilter)
    .filter(p => !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.address.toLowerCase().includes(search.toLowerCase()) ||
      p.location.toLowerCase().includes(search.toLowerCase()) ||
      p.referenceCode.toLowerCase().includes(search.toLowerCase())
    ),
    [properties, search, opFilter, typeFilter, statusFilter]
  );

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(p => { map[p.type] = (map[p.type] || 0) + 1; });
    return Object.entries(map).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const byOp = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(p => { if (p.mainOperation) map[p.mainOperation] = (map[p.mainOperation] || 0) + 1; });
    return Object.entries(map).map(([op, count]) => ({ op, count }));
  }, [filtered]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-5 md:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Propiedades</h1>
          <p className="text-muted text-sm mt-0.5">
            {loading ? 'Cargando desde Tokko...' : `${filtered.length} de ${properties.length} propiedades`}
            {lastFetch && !loading && <span className="ml-2">· actualizado {lastFetch.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>}
          </p>
        </div>
        <button
          onClick={refetch}
          disabled={loading}
          className="flex items-center gap-2 text-sm bg-bg-card border border-border rounded-xl px-4 py-2 text-white hover:border-crimson transition-all disabled:opacity-50"
        >
          <span className={loading ? 'animate-spin' : ''}>↻</span>
          {loading ? 'Sincronizando...' : 'Sincronizar Tokko'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-2xl p-5">
          <div className="text-red-400 font-medium mb-1">⚠ Error conectando con Tokko</div>
          <div className="text-red-400/70 text-sm">{error}</div>
          {error.includes('.env') && (
            <div className="mt-3 bg-black/30 rounded-xl p-3 font-mono text-xs text-green-400">
              <div># Crear archivo C:\turdo\CRM_TURDO\.env.local</div>
              <div>VITE_TOKKO_KEY=tu_api_key_aquí</div>
            </div>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && properties.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-bg-card border border-border rounded-2xl overflow-hidden animate-pulse">
              <div className="h-40 bg-bg-input" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-bg-input rounded w-3/4" />
                <div className="h-3 bg-bg-input rounded w-1/2" />
                <div className="h-3 bg-bg-input rounded w-1/3 mt-3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && properties.length > 0 && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total activas', value: properties.filter(p => p.status === 'active').length, color: 'text-green-400' },
              { label: 'Reservadas',    value: properties.filter(p => p.status === 'reserved').length, color: 'text-yellow-400' },
              { label: 'Vendidas',      value: properties.filter(p => p.status === 'sold').length, color: 'text-muted' },
              { label: 'Total Tokko',   value: properties.length, color: 'text-white' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-bg-card border border-border rounded-2xl p-4">
                <div className="text-muted text-xs uppercase tracking-wider mb-1">{label}</div>
                <div className={`text-3xl font-bold ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-bg-card border border-border rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4">Por tipo de propiedad</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={byType} layout="vertical" barSize={14}>
                  <XAxis type="number" tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="type" tick={{ fill: '#aaa', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip contentStyle={{ background: '#1A1A1A', border: '1px solid #2E2E2E', borderRadius: 8, color: '#fff' }} />
                  <Bar dataKey="count" fill="#8B1F1F" radius={3} name="Cantidad" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-bg-card border border-border rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4">Por operación</h3>
              <div className="space-y-3 mt-2">
                {byOp.map(({ op, count }) => (
                  <div key={op}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300">{op}</span>
                      <span className="text-white font-semibold">{count}</span>
                    </div>
                    <div className="h-2 bg-bg-input rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-crimson"
                        style={{ width: `${(count / filtered.length) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar título, dirección, barrio, código..."
              className="flex-1 min-w-[200px] bg-bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted outline-none focus:border-crimson"
            />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="bg-bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none cursor-pointer">
              <option value="all">Todos los estados</option>
              <option value="active">Activas</option>
              <option value="reserved">Reservadas</option>
              <option value="sold">Vendidas / Alquiladas</option>
            </select>
            <select value={opFilter} onChange={e => setOpFilter(e.target.value)}
              className="bg-bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none cursor-pointer">
              <option value="all">Todas las operaciones</option>
              {allOps.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="bg-bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none cursor-pointer">
              <option value="all">Todos los tipos</option>
              {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(prop => <PropertyCard key={prop.id} prop={prop} onClick={() => setSelected(prop)} />)}
          </div>
          {filtered.length === 0 && (
            <div className="text-center text-muted py-16">No se encontraron propiedades con esos filtros</div>
          )}
        </>
      )}

      {/* Detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? ''} width="max-w-2xl">
        {selected && (
          <div className="space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Photos */}
            {selected.photos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {selected.photos.slice(0, 6).map((ph, i) => (
                  <img key={i} src={ph} alt="" className="h-32 w-48 object-cover rounded-xl flex-shrink-0" />
                ))}
              </div>
            )}

            {/* Info grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                ['Código', selected.referenceCode || '—'],
                ['Tipo', selected.type],
                ['Estado', statusCfg[selected.status].label],
                ['Ambientes', selected.rooms || '—'],
                ['Dormitorios', selected.bedrooms || '—'],
                ['Baños', selected.bathrooms || '—'],
                ['Cochera', selected.parking || '—'],
                ['Sup. cubierta', selected.roofedSurface ? `${selected.roofedSurface}m²` : '—'],
                ['Sup. total', selected.surface ? `${selected.surface}m²` : '—'],
                ['Ubicación', selected.location || '—'],
                ['Sucursal', selected.branch || '—'],
                ['Agente', selected.agent || '—'],
              ].map(([label, val]) => (
                <div key={String(label)} className="bg-bg-input rounded-xl p-3">
                  <div className="text-muted text-xs mb-0.5">{label}</div>
                  <div className="text-white font-medium text-sm">{val}</div>
                </div>
              ))}
            </div>

            {/* Operations / Prices */}
            {selected.operations.length > 0 && (
              <div>
                <h4 className="text-white font-semibold text-sm mb-2">Operaciones y precios</h4>
                <div className="space-y-2">
                  {selected.operations.map((op, i) => (
                    <div key={i} className="flex items-center justify-between bg-bg-input rounded-xl px-4 py-3">
                      <span className="text-gray-300 text-sm">{op.type}</span>
                      <span className="text-white font-bold">{formatPrice(op.price, op.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {selected.description && (
              <div>
                <h4 className="text-white font-semibold text-sm mb-2">Descripción</h4>
                <p className="text-gray-400 text-sm leading-relaxed">{selected.description}</p>
              </div>
            )}

            {/* Tags */}
            {selected.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.tags.map(tag => (
                  <span key={tag} className="text-xs bg-crimson/20 text-crimson-bright px-2.5 py-1 rounded-full">{tag}</span>
                ))}
              </div>
            )}

            <div className="flex gap-4 justify-center pt-2">
              {selected.publicUrl && (
                <a href={selected.publicUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-crimson-bright hover:underline">
                  Ver ficha pública →
                </a>
              )}
              <a href={`https://www.tokkobroker.com/property/${selected.tokkoId}/`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-muted hover:text-white">
                Abrir en Tokko →
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
