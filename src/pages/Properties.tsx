import { useState, useMemo } from 'react';
import { PROPERTIES } from '../data/mock';
import type { Branch, Operation, Portal } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Modal } from '../components/ui/Modal';

type Prop = typeof PROPERTIES[number];

const PORTAL_COLORS: Record<Portal, string> = {
  'ZonaProp': '#F5A623', 'Argenprop': '#4CAF50', 'MercadoLibre': '#FFE600',
  'Web Propia': '#8B8B8B', 'Instagram': '#E1306C', 'Facebook': '#1877F2',
};

const formatPrice = (price: number, currency: string) =>
  currency === 'USD'
    ? `USD ${price.toLocaleString('es-AR')}`
    : `$ ${price.toLocaleString('es-AR')}`;

const PropertyCard = ({ prop, onClick }: { prop: Prop; onClick: () => void }) => (
  <div
    onClick={onClick}
    className="bg-bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:border-crimson/50 transition-all group"
  >
    {/* Image placeholder */}
    <div className="h-36 bg-gradient-to-br from-bg-input to-bg-hover flex items-center justify-center relative">
      <span className="text-4xl opacity-30">🏠</span>
      {!prop.active && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <span className="text-white text-sm font-medium bg-gray-700 px-3 py-1 rounded-full">Cerrada</span>
        </div>
      )}
      <div className="absolute top-3 left-3">
        <span className={`text-xs font-medium px-2 py-1 rounded-lg ${prop.operation === 'Venta' ? 'bg-crimson text-white' : 'bg-blue-700 text-white'}`}>
          {prop.operation}
        </span>
      </div>
    </div>
    <div className="p-4">
      <div className="text-white font-semibold text-sm line-clamp-1 group-hover:text-crimson-bright transition-colors">{prop.title}</div>
      <div className="text-muted text-xs mt-0.5 truncate">{prop.address}</div>
      <div className="text-white font-bold text-base mt-2">{formatPrice(prop.price, prop.currency)}</div>
      <div className="flex gap-3 mt-2 text-xs text-muted">
        {prop.bedrooms && <span>🛏 {prop.bedrooms}</span>}
        {prop.bathrooms && <span>🚿 {prop.bathrooms}</span>}
        <span>📐 {prop.area}m²</span>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <div className="flex gap-2">
          <span className="text-xs text-blue-400">👁 {prop.totalClicks.toLocaleString('es-AR')}</span>
          <span className="text-xs text-yellow-400">📩 {prop.totalLeads}</span>
        </div>
        <div className="flex gap-1">
          {prop.portals.filter(p => p.published).slice(0, 3).map(p => (
            <span key={p.portal} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${PORTAL_COLORS[p.portal]}20`, color: PORTAL_COLORS[p.portal] }}>
              {p.portal.split(' ')[0]}
            </span>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export default function Properties() {
  const [search, setSearch] = useState('');
  const [opFilter, setOpFilter] = useState<Operation | 'all'>('all');
  const [branchFilter, setBranchFilter] = useState<Branch | 'all'>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selected, setSelected] = useState<Prop | null>(null);

  const filtered = useMemo(() => PROPERTIES
    .filter(p => opFilter === 'all' || p.operation === opFilter)
    .filter(p => branchFilter === 'all' || p.branch === branchFilter)
    .filter(p => activeFilter === 'all' || (activeFilter === 'active' ? p.active : !p.active))
    .filter(p => !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.address.toLowerCase().includes(search.toLowerCase()) || p.neighborhood.toLowerCase().includes(search.toLowerCase())),
    [search, opFilter, branchFilter, activeFilter]
  );

  const portalStats = useMemo(() => {
    const map: Record<string, { portal: string; clicks: number; leads: number }> = {};
    PROPERTIES.filter(p => p.active).forEach(prop => {
      prop.portals.forEach(ps => {
        if (!map[ps.portal]) map[ps.portal] = { portal: ps.portal, clicks: 0, leads: 0 };
        map[ps.portal].clicks += ps.clicks;
        map[ps.portal].leads += ps.leads;
      });
    });
    return Object.values(map).sort((a, b) => b.clicks - a.clicks);
  }, []);

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Propiedades</h1>
        <p className="text-muted text-sm mt-0.5">{filtered.length} propiedades encontradas</p>
      </div>

      {/* Portal performance */}
      <div className="bg-bg-card border border-border rounded-2xl p-5">
        <h3 className="text-white font-semibold mb-4">Rendimiento por portal</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {portalStats.map(ps => (
            <div key={ps.portal} className="bg-bg-input rounded-xl p-3 text-center">
              <div className="text-xs font-medium mb-1" style={{ color: PORTAL_COLORS[ps.portal as Portal] || '#888' }}>{ps.portal}</div>
              <div className="text-white font-bold">{ps.clicks.toLocaleString('es-AR')}</div>
              <div className="text-muted text-[10px]">clics</div>
              <div className="text-yellow-400 text-xs font-medium mt-0.5">{ps.leads} leads</div>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={portalStats} barGap={2}>
            <XAxis dataKey="portal" tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#666', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#1A1A1A', border: '1px solid #2E2E2E', borderRadius: 8, color: '#fff' }} />
            <Bar dataKey="clicks" fill="#8B1F1F" radius={3} name="Clics" />
            <Bar dataKey="leads" fill="#F5A623" radius={3} name="Leads" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar propiedad, dirección, barrio..."
          className="flex-1 min-w-[200px] bg-bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted outline-none focus:border-crimson"
        />
        <select value={opFilter} onChange={e => setOpFilter(e.target.value as Operation | 'all')}
          className="bg-bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none cursor-pointer">
          <option value="all">Todas las operaciones</option>
          {(['Venta', 'Alquiler', 'Alquiler Temporal'] as Operation[]).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value as Branch | 'all')}
          className="bg-bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none cursor-pointer">
          <option value="all">Todas las sucursales</option>
          <option value="Sucursal Centro">Sucursal Centro</option>
          <option value="Sucursal Norte">Sucursal Norte</option>
        </select>
        <div className="flex bg-bg-card border border-border rounded-xl overflow-hidden">
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button key={f} onClick={() => setActiveFilter(f)}
              className={`px-3 py-2.5 text-sm transition-all ${activeFilter === f ? 'bg-crimson text-white' : 'text-muted hover:text-white'}`}>
              {f === 'all' ? 'Todas' : f === 'active' ? 'Activas' : 'Cerradas'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(prop => <PropertyCard key={prop.id} prop={prop} onClick={() => setSelected(prop)} />)}
      </div>
      {filtered.length === 0 && <div className="text-center text-muted py-12">No se encontraron propiedades</div>}

      {/* Detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? ''} width="max-w-2xl">
        {selected && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                ['Dirección', selected.address],
                ['Barrio', selected.neighborhood],
                ['Operación', selected.operation],
                ['Precio', formatPrice(selected.price, selected.currency)],
                ['Sucursal', selected.branch],
                ['Superficie', `${selected.area}m²`],
                ...(selected.bedrooms ? [['Dormitorios', selected.bedrooms]] : []),
                ...(selected.bathrooms ? [['Baños', selected.bathrooms]] : []),
              ].map(([label, val]) => (
                <div key={String(label)} className="bg-bg-input rounded-xl p-3">
                  <div className="text-muted text-xs mb-1">{label}</div>
                  <div className="text-white font-medium">{val}</div>
                </div>
              ))}
            </div>

            <div>
              <h4 className="text-white font-semibold mb-3">Portales de publicación</h4>
              <div className="space-y-2">
                {selected.portals.map(ps => (
                  <div key={ps.portal} className="flex items-center justify-between p-3 bg-bg-input rounded-xl">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${ps.published ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <span className="text-sm font-medium" style={{ color: PORTAL_COLORS[ps.portal] || '#888' }}>{ps.portal}</span>
                      {!ps.published && <span className="text-xs text-muted">(inactivo)</span>}
                    </div>
                    <div className="flex gap-4 text-xs">
                      <span className="text-blue-400">👁 {ps.clicks} clics</span>
                      <span className="text-yellow-400">📩 {ps.leads} leads</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
