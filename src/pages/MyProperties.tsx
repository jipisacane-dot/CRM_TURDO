import { useMemo, useState } from 'react';
import { useOwnProperties } from '../hooks/useOwnProperties';
import {
  properties as svc,
  STATUS_LABELS,
  STATUS_COLORS,
  PROPERTY_TYPE_LABELS,
  OPERATION_LABELS,
} from '../services/properties';
import type { PropertyWithPhotos, PropertyStatus } from '../services/properties';
import { PropertyFormModal } from '../components/PropertyFormModal';

const fmtPrice = (price: number | null, currency: string | null) => {
  if (!price) return '—';
  return `${currency ?? 'USD'} ${price.toLocaleString('es-AR')}`;
};

export default function MyProperties() {
  const { items, loading, error, refetch } = useOwnProperties();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PropertyStatus | 'all'>('all');
  const [showPublishedOnly, setShowPublishedOnly] = useState(false);
  const [editing, setEditing] = useState<PropertyWithPhotos | null>(null);
  const [showForm, setShowForm] = useState(false);

  const filtered = useMemo(() => items
    .filter(p => statusFilter === 'all' || p.status === statusFilter)
    .filter(p => !showPublishedOnly || p.is_published)
    .filter(p => !search || [p.internal_code, p.address, p.barrio, p.street]
      .some(x => (x ?? '').toLowerCase().includes(search.toLowerCase()))),
    [items, search, statusFilter, showPublishedOnly]);

  const stats = useMemo(() => ({
    total: items.length,
    borradores: items.filter(p => p.status === 'borrador').length,
    disponibles: items.filter(p => p.status === 'disponible').length,
    publicadas: items.filter(p => p.is_published).length,
  }), [items]);

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (p: PropertyWithPhotos) => { setEditing(p); setShowForm(true); };

  const togglePublish = async (p: PropertyWithPhotos) => {
    if (p.is_published) {
      await svc.unpublish(p.id);
    } else {
      const result = await svc.publish(p.id);
      if (!result.ok && result.errors?.length) {
        alert('No se puede publicar:\n\n• ' + result.errors.join('\n• '));
        return;
      }
    }
    await refetch();
  };

  const remove = async (p: PropertyWithPhotos) => {
    if (!confirm(`¿Eliminar ${p.internal_code}? Se borran las fotos también. No se puede deshacer.`)) return;
    await svc.remove(p.id);
    await refetch();
  };

  const publicUrl = (p: PropertyWithPhotos) => `${window.location.origin}/p/${p.slug}`;
  const copyLink = async (p: PropertyWithPhotos) => {
    await navigator.clipboard.writeText(publicUrl(p));
    alert('Link copiado: ' + publicUrl(p));
  };
  const shareWhatsApp = (p: PropertyWithPhotos) => {
    const msg = `${p.address ?? p.internal_code}\n${p.list_price_usd ? p.price_currency + ' ' + p.list_price_usd.toLocaleString('es-AR') : ''}\n${publicUrl(p)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div className="p-5 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Mis Propiedades</h1>
          <p className="text-muted text-sm mt-0.5">
            Cartera propia del CRM · {items.length} {items.length === 1 ? 'propiedad' : 'propiedades'} ·{' '}
            <span className="text-green-600 font-medium">{stats.publicadas} publicadas</span>
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-crimson text-white text-sm font-medium rounded-xl hover:bg-crimson-bright transition-all"
        >
          + Nueva propiedad
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Borradores" value={stats.borradores} color="text-gray-600" />
        <StatCard label="Disponibles" value={stats.disponibles} color="text-green-600" />
        <StatCard label="Publicadas" value={stats.publicadas} color="text-crimson-bright" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por código, dirección, barrio…"
          className="flex-1 min-w-[200px] bg-white border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-crimson"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as PropertyStatus | 'all')}
          className="bg-white border border-border rounded-xl px-3 py-2.5 text-sm outline-none cursor-pointer"
        >
          <option value="all">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-2 bg-white border border-border rounded-xl px-3 py-2.5 text-sm cursor-pointer">
          <input type="checkbox" checked={showPublishedOnly} onChange={e => setShowPublishedOnly(e.target.checked)} className="w-4 h-4" />
          Solo publicadas
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">⚠ {error}</div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white border border-border rounded-2xl h-72 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-border rounded-2xl">
          <div className="text-5xl mb-3 opacity-30">🏠</div>
          <p className="text-muted text-sm mb-4">
            {items.length === 0 ? 'Todavía no hay propiedades en la cartera propia.' : 'No hay propiedades con esos filtros.'}
          </p>
          {items.length === 0 && (
            <button onClick={openNew} className="px-4 py-2 bg-crimson text-white text-sm rounded-xl hover:bg-crimson-bright">
              Crear la primera
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => (
            <div key={p.id} className="bg-white border border-border rounded-2xl overflow-hidden hover:border-crimson/30 transition-all">
              {/* Cover */}
              <div className="h-44 bg-gray-100 relative">
                {p.cover_photo_url ? (
                  <img src={p.cover_photo_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl opacity-20">🏠</div>
                )}
                <div className="absolute top-2 left-2 flex gap-1.5">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${STATUS_COLORS[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                  {p.is_published && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700">🌐 Publicada</span>
                  )}
                </div>
                <div className="absolute bottom-2 right-2 bg-white/90 text-[10px] px-2 py-0.5 rounded-md font-mono">
                  {p.internal_code}
                </div>
              </div>

              <div className="p-4">
                <div className="text-sm font-semibold text-[#0F172A] truncate">
                  {p.address ?? '—'}
                </div>
                <div className="text-xs text-muted truncate">
                  {p.barrio ?? p.city} · {PROPERTY_TYPE_LABELS[p.property_type]} · {OPERATION_LABELS[p.operation_type]}
                </div>
                <div className="text-lg font-bold text-crimson-bright mt-1">
                  {fmtPrice(p.list_price_usd, p.price_currency)}
                </div>

                <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-gray-600">
                  {p.rooms != null && <span>🚪 {p.rooms} amb</span>}
                  {p.bedrooms != null && <span>🛏 {p.bedrooms}</span>}
                  {p.bathrooms != null && <span>🚿 {p.bathrooms}</span>}
                  {p.surface_m2 != null && <span>📐 {p.surface_m2}m²</span>}
                  {p.photos.length > 0 && <span>📷 {p.photos.length}</span>}
                </div>

                <div className="flex gap-1.5 mt-3 pt-3 border-t border-border">
                  <button onClick={() => openEdit(p)} className="flex-1 text-xs py-1.5 bg-bg-input hover:bg-bg-hover rounded-lg text-gray-700">
                    Editar
                  </button>
                  <button
                    onClick={() => togglePublish(p)}
                    className={`flex-1 text-xs py-1.5 rounded-lg ${
                      p.is_published ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-crimson text-white hover:bg-crimson-bright'
                    }`}
                  >
                    {p.is_published ? 'Despublicar' : 'Publicar'}
                  </button>
                  <button onClick={() => remove(p)} className="text-xs py-1.5 px-2 bg-red-50 hover:bg-red-100 rounded-lg text-red-600" title="Eliminar">
                    🗑
                  </button>
                </div>
                {p.is_published && p.slug && (
                  <div className="flex gap-1.5 mt-1.5">
                    <button onClick={() => shareWhatsApp(p)} className="flex-1 text-xs py-1.5 bg-green-50 hover:bg-green-100 rounded-lg text-green-700">
                      📱 WhatsApp
                    </button>
                    <button onClick={() => copyLink(p)} className="flex-1 text-xs py-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-700">
                      🔗 Copiar link
                    </button>
                    <a
                      href={publicUrl(p)}
                      target="_blank"
                      rel="noopener"
                      className="text-xs py-1.5 px-2 bg-bg-input hover:bg-bg-hover rounded-lg text-gray-700"
                      title="Ver ficha pública"
                    >
                      👁
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <PropertyFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        property={editing}
        onSaved={() => { void refetch(); }}
      />
    </div>
  );
}

const StatCard = ({ label, value, color = 'text-[#0F172A]' }: { label: string; value: number; color?: string }) => (
  <div className="bg-white border border-border rounded-2xl p-4">
    <div className="text-muted text-[11px] uppercase tracking-wider">{label}</div>
    <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
  </div>
);
