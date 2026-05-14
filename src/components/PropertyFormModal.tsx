import { useEffect, useRef, useState } from 'react';
import {
  properties as svc,
  AMENITIES_OPTIONS,
  PROPERTY_TYPE_LABELS,
  OPERATION_LABELS,
  CONDITION_LABELS,
  STATUS_LABELS,
} from '../services/properties';
import type {
  PropertyWithPhotos,
  DBProperty,
  PropertyStatus,
  OperationType,
  PropertyType,
  PropertyCondition,
  PriceCurrency,
} from '../services/properties';
import { Modal } from './ui/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  property?: PropertyWithPhotos | null;
  onSaved: () => void;
}

const emptyDraft = (): Partial<DBProperty> => ({
  operation_type: 'venta',
  property_type: 'departamento',
  status: 'borrador',
  is_published: false,
  price_currency: 'USD',
  city: 'Mar del Plata',
  province: 'Buenos Aires',
  country: 'Argentina',
  condition: 'usado',
  amenities: [],
  garage: 0,
});

export function PropertyFormModal({ open, onClose, property, onSaved }: Props) {
  const [draft, setDraft] = useState<Partial<DBProperty>>(emptyDraft);
  const [photos, setPhotos] = useState<PropertyWithPhotos['photos']>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<'basico' | 'ubicacion' | 'detalles' | 'amenities' | 'descripcion' | 'fotos' | 'historial'>('basico');
  const [statusHist, setStatusHist] = useState<Array<{ old_status: string | null; new_status: string; changed_at: string; reason: string | null }>>([]);
  const [priceHist, setPriceHist] = useState<Array<{ old_price: number | null; new_price: number; currency: string; changed_at: string; reason: string | null }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (property) {
      setDraft(property);
      setPhotos(property.photos);
    } else {
      setDraft(emptyDraft());
      setPhotos([]);
    }
    setError(null);
    setSection('basico');
  }, [property, open]);

  useEffect(() => {
    if (!property || section !== 'historial') return;
    void svc.getStatusHistory(property.id).then(setStatusHist);
    void svc.getPriceHistory(property.id).then(setPriceHist);
  }, [property, section]);

  const set = <K extends keyof DBProperty>(k: K, v: DBProperty[K] | null) => setDraft(d => ({ ...d, [k]: v }));

  const toggleAmenity = (key: string) => {
    const cur = new Set(draft.amenities ?? []);
    if (cur.has(key)) cur.delete(key);
    else cur.add(key);
    set('amenities', Array.from(cur));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Address fallback: si no hay address pero hay street + number, lo construimos
      const patch: Partial<DBProperty> = { ...draft };
      if (!patch.address && patch.street) {
        patch.address = patch.street + (patch.street_number ? ' ' + patch.street_number : '');
      }
      if (property) {
        await svc.update(property.id, patch);
      } else {
        await svc.create(patch);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !property) return;
    setError(null);
    try {
      const base = photos.length;
      const arr = Array.from(files);
      for (let i = 0; i < arr.length; i++) {
        const isCover = base === 0 && i === 0; // primera foto = portada si no hay otras
        const ph = await svc.uploadPhoto(property.id, arr[i], base + i, isCover);
        setPhotos(prev => [...prev, ph]);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removePhoto = async (id: string) => {
    if (!confirm('¿Borrar esta foto?')) return;
    await svc.removePhoto(id);
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  const makeCover = async (id: string) => {
    if (!property) return;
    await svc.setCoverPhoto(property.id, id);
    setPhotos(prev => prev.map(p => ({ ...p, is_cover: p.id === id })));
  };

  // Drag and drop reorder
  const dragIdRef = useRef<string | null>(null);
  const onDragStart = (id: string) => () => {
    dragIdRef.current = id;
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (targetId: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragIdRef.current;
    if (!src || src === targetId || !property) return;
    const ordered = [...photos];
    const fromIdx = ordered.findIndex(p => p.id === src);
    const toIdx = ordered.findIndex(p => p.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    setPhotos(ordered.map((p, i) => ({ ...p, order_index: i })));
    await svc.reorderPhotos(property.id, ordered.map(p => p.id));
  };

  const SectionTab = ({ id, label, num }: { id: typeof section; label: string; num: number }) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
        section === id ? 'bg-crimson text-white' : 'bg-bg-input text-gray-600 hover:bg-bg-hover'
      }`}
    >
      <span className="opacity-50 mr-1">{num}.</span>
      {label}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title={property ? `${property.internal_code} · Editar` : 'Nueva propiedad'} width="max-w-3xl">
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
        <SectionTab id="basico" label="Básico" num={1} />
        <SectionTab id="ubicacion" label="Ubicación" num={2} />
        <SectionTab id="detalles" label="Detalles" num={3} />
        <SectionTab id="amenities" label="Amenities" num={4} />
        <SectionTab id="descripcion" label="Descripción" num={5} />
        {property && <SectionTab id="fotos" label={`Fotos (${photos.length})`} num={6} />}
        {property && <SectionTab id="historial" label="Historial" num={7} />}
      </div>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {/* ── BÁSICO ──────────────────────────── */}
        {section === 'basico' && (
          <div className="space-y-3">
            <Row>
              <Field label="Operación" required>
                <Select value={draft.operation_type ?? 'venta'} onChange={v => set('operation_type', v as OperationType)}>
                  {Object.entries(OPERATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Tipo de propiedad" required>
                <Select value={draft.property_type ?? 'departamento'} onChange={v => set('property_type', v as PropertyType)}>
                  {Object.entries(PROPERTY_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
            </Row>

            <Row>
              <Field label="Precio" required>
                <Input
                  type="number"
                  value={draft.list_price_usd?.toString() ?? ''}
                  onChange={v => set('list_price_usd', v ? Number(v) : null)}
                  placeholder="125000"
                />
              </Field>
              <Field label="Moneda">
                <Select value={draft.price_currency ?? 'USD'} onChange={v => set('price_currency', v as PriceCurrency)}>
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </Select>
              </Field>
              <Field label="Expensas (ARS)">
                <Input
                  type="number"
                  value={draft.expenses_ars?.toString() ?? ''}
                  onChange={v => set('expenses_ars', v ? Number(v) : null)}
                  placeholder="80000"
                />
              </Field>
            </Row>

            <Row>
              <Field label="Estado">
                <Select value={draft.status ?? 'borrador'} onChange={v => set('status', v as PropertyStatus)}>
                  {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Condición">
                <Select value={draft.condition ?? 'usado'} onChange={v => set('condition', v as PropertyCondition)}>
                  {Object.entries(CONDITION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
            </Row>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!draft.is_published}
                onChange={e => set('is_published', e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">Publicar en la web pública / portales</span>
            </label>
          </div>
        )}

        {/* ── UBICACIÓN ────────────────────────── */}
        {section === 'ubicacion' && (
          <div className="space-y-3">
            <Row>
              <Field label="Calle">
                <Input value={draft.street ?? ''} onChange={v => set('street', v || null)} placeholder="Av. Colón" />
              </Field>
              <Field label="Altura">
                <Input value={draft.street_number ?? ''} onChange={v => set('street_number', v || null)} placeholder="2300" />
              </Field>
              <Field label="Piso">
                <Input value={draft.floor ?? ''} onChange={v => set('floor', v || null)} placeholder="3°" />
              </Field>
              <Field label="Depto">
                <Input value={draft.apartment_letter ?? ''} onChange={v => set('apartment_letter', v || null)} placeholder="B" />
              </Field>
            </Row>

            <Field label="Dirección legible (auto si dejás vacío)">
              <Input
                value={draft.address ?? ''}
                onChange={v => set('address', v || null)}
                placeholder="Si dejás vacío se arma con calle + altura"
              />
            </Field>

            <Row>
              <Field label="Barrio">
                <Input value={draft.barrio ?? ''} onChange={v => set('barrio', v || null)} placeholder="Plaza Mitre" />
              </Field>
              <Field label="Ciudad">
                <Input value={draft.city ?? 'Mar del Plata'} onChange={v => set('city', v)} />
              </Field>
              <Field label="Provincia">
                <Input value={draft.province ?? 'Buenos Aires'} onChange={v => set('province', v)} />
              </Field>
            </Row>

            <Row>
              <Field label="Latitud (opcional)">
                <Input
                  type="number"
                  value={draft.latitude?.toString() ?? ''}
                  onChange={v => set('latitude', v ? Number(v) : null)}
                  placeholder="-38.005"
                />
              </Field>
              <Field label="Longitud (opcional)">
                <Input
                  type="number"
                  value={draft.longitude?.toString() ?? ''}
                  onChange={v => set('longitude', v ? Number(v) : null)}
                  placeholder="-57.542"
                />
              </Field>
            </Row>
          </div>
        )}

        {/* ── DETALLES ────────────────────────── */}
        {section === 'detalles' && (
          <div className="space-y-3">
            <Row>
              <Field label="Ambientes">
                <Input type="number" value={draft.rooms?.toString() ?? ''} onChange={v => set('rooms', v ? Number(v) : null)} placeholder="3" />
              </Field>
              <Field label="Dormitorios">
                <Input type="number" value={draft.bedrooms?.toString() ?? ''} onChange={v => set('bedrooms', v ? Number(v) : null)} placeholder="2" />
              </Field>
              <Field label="Baños">
                <Input type="number" value={draft.bathrooms?.toString() ?? ''} onChange={v => set('bathrooms', v ? Number(v) : null)} placeholder="1" />
              </Field>
              <Field label="Cocheras">
                <Input type="number" value={draft.garage?.toString() ?? ''} onChange={v => set('garage', v ? Number(v) : null)} placeholder="0" />
              </Field>
            </Row>
            <Row>
              <Field label="Sup. cubierta (m²)">
                <Input
                  type="number"
                  value={draft.surface_m2?.toString() ?? ''}
                  onChange={v => set('surface_m2', v ? Number(v) : null)}
                  placeholder="65"
                />
              </Field>
              <Field label="Sup. total (m²)">
                <Input
                  type="number"
                  value={draft.surface_total_m2?.toString() ?? ''}
                  onChange={v => set('surface_total_m2', v ? Number(v) : null)}
                  placeholder="70"
                />
              </Field>
              <Field label="Antigüedad (años)">
                <Input
                  type="number"
                  value={draft.age_years?.toString() ?? ''}
                  onChange={v => set('age_years', v ? Number(v) : null)}
                  placeholder="20"
                />
              </Field>
            </Row>
            <Row>
              <Field label="Orientación">
                <Select value={draft.orientation ?? ''} onChange={v => set('orientation', v || null)}>
                  <option value="">—</option>
                  <option value="N">Norte</option>
                  <option value="S">Sur</option>
                  <option value="E">Este</option>
                  <option value="O">Oeste</option>
                  <option value="NE">NE</option>
                  <option value="NO">NO</option>
                  <option value="SE">SE</option>
                  <option value="SO">SO</option>
                </Select>
              </Field>
              <Field label="Video URL (reel, tour virtual)">
                <Input value={draft.video_url ?? ''} onChange={v => set('video_url', v || null)} placeholder="https://..." />
              </Field>
              <Field label="Plano URL">
                <Input value={draft.floor_plan_url ?? ''} onChange={v => set('floor_plan_url', v || null)} placeholder="https://..." />
              </Field>
            </Row>
          </div>
        )}

        {/* ── AMENITIES ────────────────────────── */}
        {section === 'amenities' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {AMENITIES_OPTIONS.map(opt => {
              const on = (draft.amenities ?? []).includes(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleAmenity(opt.key)}
                  className={`text-left px-3 py-2 rounded-xl border text-sm transition-all ${
                    on ? 'bg-crimson/10 border-crimson text-crimson-bright' : 'bg-bg-card border-border text-gray-700 hover:border-crimson/50'
                  }`}
                >
                  <span className="mr-1.5">{opt.icon}</span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ── DESCRIPCIÓN ───────────────────────── */}
        {section === 'descripcion' && (
          <div className="space-y-3">
            <Field label="Descripción para el anuncio (web / ML / ZP)">
              <textarea
                value={draft.description ?? ''}
                onChange={e => set('description', e.target.value || null)}
                rows={8}
                placeholder="Hermoso departamento ubicado en pleno centro de Mar del Plata..."
                className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:border-crimson resize-none"
              />
            </Field>
            <Field label="Notas internas (no se publica)">
              <textarea
                value={draft.notes ?? ''}
                onChange={e => set('notes', e.target.value || null)}
                rows={3}
                placeholder="Llave en sucursal centro, propietario consigna 15/05..."
                className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:border-crimson resize-none"
              />
            </Field>
          </div>
        )}

        {/* ── FOTOS ─────────────────────────────── */}
        {section === 'fotos' && property && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">Arrastrá para reordenar. La estrella ⭐ marca la portada.</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-3 py-1.5 bg-crimson text-white text-sm rounded-lg hover:bg-crimson-bright"
              >
                + Subir fotos
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={e => void handleFiles(e.target.files)}
              />
            </div>

            {photos.length === 0 ? (
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-border rounded-2xl p-12 text-center cursor-pointer hover:border-crimson transition-all"
              >
                <div className="text-4xl mb-2">📷</div>
                <p className="text-muted text-sm">Cliquéa o arrastrá tus fotos acá</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {photos.map(ph => (
                  <div
                    key={ph.id}
                    draggable
                    onDragStart={onDragStart(ph.id)}
                    onDragOver={onDragOver}
                    onDrop={onDrop(ph.id)}
                    className="relative group rounded-xl overflow-hidden bg-bg-input border border-border cursor-move"
                  >
                    <img src={ph.url} alt="" className="w-full h-32 object-cover" loading="lazy" decoding="async" />
                    <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                      #{ph.order_index + 1}
                    </div>
                    {ph.is_cover && (
                      <div className="absolute top-1 right-1 bg-yellow-500 text-white text-[10px] px-1.5 py-0.5 rounded">⭐ Portada</div>
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      {!ph.is_cover && (
                        <button type="button" onClick={() => makeCover(ph.id)} className="bg-white px-2 py-1 rounded text-xs">
                          ⭐ Portada
                        </button>
                      )}
                      <button type="button" onClick={() => removePhoto(ph.id)} className="bg-red-600 text-white px-2 py-1 rounded text-xs">
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── HISTORIAL ─────────────────────────── */}
        {section === 'historial' && property && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-[#0F172A] mb-2">Cambios de estado</h4>
              {statusHist.length === 0 ? (
                <p className="text-xs text-muted">Sin cambios registrados.</p>
              ) : (
                <div className="space-y-1.5">
                  {statusHist.map((h, i) => (
                    <div key={i} className="text-xs bg-bg-input rounded-lg px-3 py-2 flex items-center justify-between">
                      <span className="text-gray-700">
                        {h.old_status ? `${h.old_status} → ` : ''}
                        <strong>{h.new_status}</strong>
                      </span>
                      <span className="text-muted">{new Date(h.changed_at).toLocaleString('es-AR')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-semibold text-[#0F172A] mb-2">Cambios de precio</h4>
              {priceHist.length === 0 ? (
                <p className="text-xs text-muted">Sin cambios registrados.</p>
              ) : (
                <div className="space-y-1.5">
                  {priceHist.map((h, i) => {
                    const delta = h.old_price ? (((h.new_price - h.old_price) / h.old_price) * 100).toFixed(1) : null;
                    const dir = h.old_price && h.new_price > h.old_price ? '↑' : h.old_price && h.new_price < h.old_price ? '↓' : '';
                    return (
                      <div key={i} className="text-xs bg-bg-input rounded-lg px-3 py-2 flex items-center justify-between">
                        <span className="text-gray-700">
                          {h.old_price ? `${h.currency} ${h.old_price.toLocaleString('es-AR')} → ` : ''}
                          <strong>{h.currency} {h.new_price.toLocaleString('es-AR')}</strong>
                          {delta && <span className={`ml-2 ${dir === '↓' ? 'text-green-600' : 'text-red-600'}`}>{dir} {Math.abs(Number(delta))}%</span>}
                        </span>
                        <span className="text-muted">{new Date(h.changed_at).toLocaleString('es-AR')}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-3 mt-3">⚠ {error}</div>}

      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-bg-hover rounded-lg">
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-crimson text-white text-sm font-medium rounded-lg hover:bg-crimson-bright disabled:opacity-50"
        >
          {saving ? 'Guardando…' : property ? 'Guardar cambios' : 'Crear propiedad'}
        </button>
      </div>
    </Modal>
  );
}

// ── Helpers UI ────────────────────────────────────────────────────────────────

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{children}</div>
);

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-xs text-muted block mb-1">
      {label}
      {required && <span className="text-crimson ml-0.5">*</span>}
    </span>
    {children}
  </label>
);

const Input = ({
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) => (
  <input
    type={type}
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:border-crimson"
  />
);

const Select = ({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    className="w-full bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:border-crimson"
  >
    {children}
  </select>
);
