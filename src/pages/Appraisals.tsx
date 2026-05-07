import { useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { appraisalsApi, type PropertyInput, type AppraisalResult } from '../services/appraisals';
import { generateAppraisalPdf } from '../services/appraisalPdf';
import PageHeader from '../components/ui/PageHeader';
import { supabase } from '../services/supabase';

const STATES = [
  { value: 'a_estrenar', label: 'A estrenar' },
  { value: 'reciclado', label: 'Reciclado a estrenar' },
  { value: 'usado_buen_estado', label: 'Usado, buen estado' },
  { value: 'usado_regular', label: 'Usado, regular' },
];

const VIEWS = [
  { value: '', label: 'Sin vista destacada' },
  { value: 'al_mar', label: 'Al mar' },
  { value: 'lateral_mar', label: 'Lateral al mar' },
  { value: 'a_la_calle', label: 'A la calle' },
  { value: 'interno', label: 'Interno' },
];

const AMENITIES_LIST = [
  { key: 'balcon', label: 'Balcón' },
  { key: 'ascensor', label: 'Ascensor' },
  { key: 'cochera', label: 'Cochera' },
  { key: 'amenities', label: 'Amenities' },
  { key: 'parrilla', label: 'Parrilla' },
  { key: 'piscina', label: 'Piscina' },
  { key: 'sum', label: 'SUM' },
  { key: 'alarma', label: 'Alarma' },
  { key: 'mascotas', label: 'Mascotas permitidas' },
];

const EXPOSURES = [
  { value: '', label: '—' },
  { value: 'frente', label: 'Frente' },
  { value: 'contrafrente', label: 'Contrafrente' },
  { value: 'lateral', label: 'Lateral' },
];

export default function Appraisals() {
  const { currentUser } = useApp();

  const [step, setStep] = useState<'form' | 'loading' | 'result'>('form');
  const [property, setProperty] = useState<PropertyInput>({
    address: '',
    barrio: '',
    rooms: undefined,
    bedrooms: undefined,
    surface_m2: undefined,
    age_years: undefined,
    property_state: undefined,
    has_view: false,
    view_type: undefined,
    amenities: [],
    floor_number: undefined,
    exposure: undefined,
    expenses_ars: undefined,
    is_furnished: false,
    notes: '',
  });
  const [client, setClient] = useState({ name: '', email: '', phone: '' });
  const [photos, setPhotos] = useState<Array<{ url: string; caption?: string }>>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [result, setResult] = useState<AppraisalResult | null>(null);
  const [editedLow, setEditedLow] = useState<number>(0);
  const [editedHigh, setEditedHigh] = useState<number>(0);
  const [confirmedToken, setConfirmedToken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const toggleAmenity = (key: string) => {
    setProperty(p => ({
      ...p,
      amenities: p.amenities?.includes(key)
        ? p.amenities.filter(a => a !== key)
        : [...(p.amenities ?? []), key],
    }));
  };

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const newPhotos: typeof photos = [];
      const failures: string[] = [];
      for (const file of Array.from(files).slice(0, 6 - photos.length)) {
        if (!file.type.startsWith('image/')) {
          failures.push(`${file.name}: no es una imagen válida`);
          continue;
        }
        const compressed = await compressImage(file);
        const ext = compressed.type.split('/')[1] ?? 'jpg';
        const path = `appraisals/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('chat-media').upload(path, compressed, {
          contentType: compressed.type,
          upsert: false,
        });
        if (upErr) {
          failures.push(`${file.name}: ${upErr.message}`);
          continue;
        }
        const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path);
        newPhotos.push({ url: pub.publicUrl });
      }
      if (newPhotos.length > 0) setPhotos(prev => [...prev, ...newPhotos]);
      if (failures.length > 0) {
        setError(`No se pudieron subir ${failures.length} foto(s):\n${failures.join('\n')}`);
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = (idx: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (!property.address.trim()) {
      setError('La dirección es obligatoria.');
      return;
    }
    setError(null);
    setStep('loading');
    try {
      const r = await appraisalsApi.preview({
        property,
        client: (client.name || client.phone) ? client : undefined,
        photos,
        agent_id: currentUser.id,
        agent_email: currentUser.email,
      });
      if (!r || typeof r.suggested_price_low_usd !== 'number') {
        throw new Error('La IA no devolvió un resultado válido. Intentá de nuevo.');
      }
      setResult(r);
      setEditedLow(r.suggested_price_low_usd);
      setEditedHigh(r.suggested_price_high_usd);
      setConfirmedToken(null);
      setStep('result');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      console.error('Appraisal error:', e);
      setError(`No se pudo generar la tasación: ${(e as Error).message ?? 'error desconocido'}`);
      setStep('form');
    }
  };

  const confirmAppraisal = async () => {
    if (!result) return;
    if (!editedLow || !editedHigh || editedLow >= editedHigh) {
      setError('El precio mínimo debe ser menor que el máximo.');
      return;
    }
    setError(null);
    setConfirming(true);
    try {
      const r = await appraisalsApi.confirm({
        property,
        client: (client.name || client.phone) ? client : undefined,
        photos,
        agent_id: currentUser.id,
        agent_email: currentUser.email,
        suggested_price_low_usd: editedLow,
        suggested_price_high_usd: editedHigh,
        ai_suggested_low_usd: result.suggested_price_low_usd,
        ai_suggested_high_usd: result.suggested_price_high_usd,
        comparables: result.comparables,
        ai_reasoning: result.ai_reasoning,
        calculation_breakdown: result.calculation_breakdown,
        market_summary: result.market_summary,
        recommendations: result.recommendations,
        estimated_sale_days: result.estimated_sale_days,
      });
      setConfirmedToken(r.share_token);
    } catch (e) {
      setError(`No se pudo guardar la tasación: ${(e as Error).message ?? 'error desconocido'}`);
    } finally {
      setConfirming(false);
    }
  };

  const downloadPdf = async () => {
    if (!result) return;
    const doc = await generateAppraisalPdf({
      property_address: property.address,
      barrio: property.barrio,
      rooms: property.rooms,
      bedrooms: property.bedrooms,
      surface_m2: property.surface_m2,
      surface_total_m2: property.surface_total_m2,
      age_years: property.age_years,
      property_state: property.property_state,
      has_view: property.has_view,
      view_type: property.view_type,
      amenities: property.amenities,
      expenses_ars: property.expenses_ars,
      floor_number: property.floor_number,
      exposure: property.exposure,
      client_name: client.name || null,
      suggested_price_low_usd: editedLow || result.suggested_price_low_usd,
      suggested_price_high_usd: editedHigh || result.suggested_price_high_usd,
      comparables: result.comparables,
      ai_reasoning: result.ai_reasoning,
      market_summary: result.market_summary,
      recommendations: result.recommendations,
      estimated_sale_days: result.estimated_sale_days,
      agent_name: currentUser.name,
      agent_phone: '+54 9 223 525-2984',
      agent_email: currentUser.email,
    });
    const filename = `Tasacion-${property.address.replace(/[^a-zA-Z0-9]/g, '_')}-${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
  };

  const newAppraisal = () => {
    setStep('form');
    setResult(null);
    setEditedLow(0);
    setEditedHigh(0);
    setConfirmedToken(null);
    setError(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl">
      <PageHeader
        title="Tasación de propiedad"
        subtitle="Completá los datos del depto y la IA arma una tasación profesional con comparables del mercado actual + PDF listo para mandar al cliente."
        actions={step === 'form' ? (
          <button
            onClick={submit}
            disabled={!property.address.trim()}
            className="bg-crimson hover:bg-crimson-light text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            ✨ Generar tasación
          </button>
        ) : undefined}
      />

      {step === 'form' && (
        <div className="bg-white border border-border rounded-2xl p-5 md:p-6 space-y-5">
          {/* Sección: ubicación */}
          <Section title="Ubicación">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Dirección" required>
                <input
                  value={property.address}
                  onChange={e => setProperty(p => ({ ...p, address: e.target.value }))}
                  placeholder="Av. Colón 2300, Piso 5° E"
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson"
                />
              </Field>
              <Field label="Barrio / Zona">
                <input
                  value={property.barrio ?? ''}
                  onChange={e => setProperty(p => ({ ...p, barrio: e.target.value }))}
                  placeholder="Plaza Mitre"
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson"
                />
              </Field>
            </div>
          </Section>

          <Section title="Características">
            <div className="grid md:grid-cols-3 gap-3">
              <Field label="Ambientes">
                <input type="number" value={property.rooms ?? ''}
                  onChange={e => setProperty(p => ({ ...p, rooms: e.target.value ? +e.target.value : undefined }))}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" />
              </Field>
              <Field label="Dormitorios">
                <input type="number" value={property.bedrooms ?? ''}
                  onChange={e => setProperty(p => ({ ...p, bedrooms: e.target.value ? +e.target.value : undefined }))}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" />
              </Field>
              <Field label="m² cubiertos">
                <input type="number" value={property.surface_m2 ?? ''}
                  onChange={e => setProperty(p => ({ ...p, surface_m2: e.target.value ? +e.target.value : undefined }))}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" />
              </Field>
              <Field label="Antigüedad (años)">
                <input type="number" value={property.age_years ?? ''}
                  onChange={e => setProperty(p => ({ ...p, age_years: e.target.value ? +e.target.value : undefined }))}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" />
              </Field>
              <Field label="Piso">
                <input type="number" value={property.floor_number ?? ''}
                  onChange={e => setProperty(p => ({ ...p, floor_number: e.target.value ? +e.target.value : undefined }))}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" />
              </Field>
              <Field label="Orientación">
                <select value={property.exposure ?? ''}
                  onChange={e => setProperty(p => ({ ...p, exposure: e.target.value as PropertyInput['exposure'] || undefined }))}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson">
                  {EXPOSURES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              <Field label="Estado">
                <select value={property.property_state ?? ''}
                  onChange={e => setProperty(p => ({ ...p, property_state: e.target.value as PropertyInput['property_state'] || undefined }))}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson">
                  <option value="">— Seleccionar —</option>
                  {STATES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Vista">
                <select value={property.view_type ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    setProperty(p => ({ ...p, view_type: v as PropertyInput['view_type'] || undefined, has_view: !!v }));
                  }}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson">
                  {VIEWS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Expensas (ARS/mes)">
                <input type="number" value={property.expenses_ars ?? ''}
                  onChange={e => setProperty(p => ({ ...p, expenses_ars: e.target.value ? +e.target.value : undefined }))}
                  className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" />
              </Field>
            </div>
            <div className="mt-3">
              <label className="flex items-center gap-2 cursor-pointer select-none p-3 bg-bg-soft rounded-lg border border-border hover:border-crimson transition-colors">
                <input
                  type="checkbox"
                  checked={!!property.is_furnished}
                  onChange={e => setProperty(p => ({ ...p, is_furnished: e.target.checked }))}
                  className="w-4 h-4 accent-crimson"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[#0F172A]">Vendido amueblado</div>
                  <div className="text-[11px] text-muted">En reciclados y a estrenar suma 5-10% al precio</div>
                </div>
              </label>
            </div>

            <div className="mt-3">
              <label className="text-xs font-medium text-muted block mb-1.5">Amenities</label>
              <div className="flex flex-wrap gap-1.5">
                {AMENITIES_LIST.map(a => {
                  const checked = property.amenities?.includes(a.key);
                  return (
                    <button
                      key={a.key} type="button"
                      onClick={() => toggleAmenity(a.key)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                        checked ? 'bg-crimson text-white border-crimson' : 'bg-white border-border text-muted hover:border-crimson'
                      }`}
                    >
                      {checked ? '✓ ' : ''}{a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>

          <Section title="Notas adicionales (opcional)">
            <textarea
              value={property.notes ?? ''}
              onChange={e => setProperty(p => ({ ...p, notes: e.target.value }))}
              rows={3}
              placeholder="Detalles relevantes: estado del edificio, mejoras recientes, particularidades, etc."
              className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson resize-none"
            />
          </Section>

          <Section title="Fotos del depto (opcional, hasta 6)">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={e => handlePhotoUpload(e.target.files)}
              hidden
            />
            {photos.length > 0 ? (
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-bg-soft group">
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    >✕</button>
                  </div>
                ))}
                {photos.length < 6 && (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-crimson hover:text-crimson text-muted text-2xl flex items-center justify-center disabled:opacity-50"
                  >
                    {uploadingPhoto ? '...' : '+'}
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="w-full bg-bg-soft hover:bg-bg-input border-2 border-dashed border-border rounded-xl py-6 text-sm text-muted disabled:opacity-50"
              >
                {uploadingPhoto ? 'Subiendo…' : '📷 Tocá para subir fotos del depto'}
              </button>
            )}
            <p className="text-[11px] text-muted mt-1.5">
              Las fotos aparecen en el link compartible para que el cliente las vea junto con la tasación.
            </p>
          </Section>

          <Section title="Cliente / propietario (opcional)">
            <div className="grid md:grid-cols-3 gap-3">
              <Field label="Nombre">
                <input value={client.name} onChange={e => setClient(c => ({ ...c, name: e.target.value }))} className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" />
              </Field>
              <Field label="Teléfono">
                <input value={client.phone} onChange={e => setClient(c => ({ ...c, phone: e.target.value }))} className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" inputMode="tel" />
              </Field>
              <Field label="Email">
                <input value={client.email} onChange={e => setClient(c => ({ ...c, email: e.target.value }))} className="w-full px-3 py-2.5 border border-border rounded-[10px] text-sm text-[#0F172A] bg-white outline-none focus:border-crimson" inputMode="email" />
              </Field>
            </div>
          </Section>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

          {/* Botón submit al final del form, normal (no sticky) */}
          <div className="pt-2">
            <button
              onClick={submit}
              disabled={!property.address.trim()}
              className="w-full bg-crimson hover:bg-crimson-light text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              ✨ Generar tasación con IA
            </button>
            <p className="text-[11px] text-muted text-center mt-2">
              {!property.address.trim()
                ? 'Cargá al menos la dirección para tasar'
                : 'La IA tarda 5-10 segundos. Después descargás el PDF profesional.'}
            </p>
          </div>
        </div>
      )}

      {step === 'loading' && (
        <div className="bg-white border border-border rounded-2xl p-12 text-center">
          <div className="inline-block w-12 h-12 border-4 border-crimson border-t-transparent rounded-full animate-spin mb-4" />
          <h3 className="text-lg font-semibold text-[#0F172A]">Tasando con IA…</h3>
          <p className="text-sm text-muted mt-1">Buscando comparables en Tokko · razonando precio · armando análisis</p>
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-4">
          {/* Hero con precio EDITABLE */}
          <div className="bg-gradient-to-br from-crimson to-[#A52828] rounded-2xl p-6 text-white">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-xs uppercase tracking-wider opacity-80">Precio sugerido por la IA</div>
              <div className="text-[10px] uppercase tracking-wider opacity-70">editable</div>
            </div>
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider opacity-75 mb-1 ml-1">Mínimo (cierre esperado)</div>
                <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
                  <span className="text-sm opacity-80">USD</span>
                  <input
                    type="number"
                    value={editedLow || ''}
                    onChange={e => { setEditedLow(Number(e.target.value) || 0); setConfirmedToken(null); }}
                    className="bg-transparent text-white text-2xl md:text-3xl font-bold tabular-nums outline-none w-full placeholder-white/40"
                    placeholder="0"
                  />
                </div>
              </div>
              <span className="text-2xl opacity-60 text-center md:mt-5">—</span>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider opacity-75 mb-1 ml-1">Máximo (publicación)</div>
                <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
                  <span className="text-sm opacity-80">USD</span>
                  <input
                    type="number"
                    value={editedHigh || ''}
                    onChange={e => { setEditedHigh(Number(e.target.value) || 0); setConfirmedToken(null); }}
                    className="bg-transparent text-white text-2xl md:text-3xl font-bold tabular-nums outline-none w-full placeholder-white/40"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
            {editedLow > 0 && editedHigh > 0 && editedLow >= editedHigh && (
              <div className="mt-3 bg-amber-400/30 border border-amber-300 rounded-lg px-3 py-2 text-sm text-amber-50">
                ⚠ El precio mínimo (USD {editedLow.toLocaleString('es-AR')}) debe ser MENOR que el máximo (USD {editedHigh.toLocaleString('es-AR')}).
              </div>
            )}
            {result.estimated_sale_days > 0 && (
              <div className="text-sm mt-3 opacity-90">
                Tiempo estimado de venta: {result.estimated_sale_days} días
              </div>
            )}
            <div className="text-[11px] opacity-75 mt-2">
              Original IA: USD {result.suggested_price_low_usd.toLocaleString('es-AR')} — USD {result.suggested_price_high_usd.toLocaleString('es-AR')}
            </div>
          </div>

          {/* Cálculo del modelo (técnico, para el vendedor) */}
          {result.calculation_breakdown && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
              <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-2">🧮 Cálculo del modelo (uso interno)</h3>
              <p className="text-sm text-[#0F172A] leading-relaxed whitespace-pre-line tabular-nums">{result.calculation_breakdown}</p>
            </div>
          )}

          {/* Comparables — ahora con USD/m² y fuente */}
          {result.comparables.length > 0 && (
            <div className="bg-white border border-border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider mb-3">
                Comparables ({result.comparables.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted uppercase">
                      <th className="text-left py-2 pr-2">Fuente</th>
                      <th className="text-left py-2">Dirección</th>
                      <th className="text-right py-2">Precio</th>
                      <th className="text-right py-2">m²</th>
                      <th className="text-right py-2">USD/m²</th>
                      <th className="text-left py-2 pl-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.comparables.map((c, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-2 text-xs text-muted">{c.source ?? '—'}</td>
                        <td className="py-2 text-[#0F172A] truncate max-w-[200px]">{c.address}</td>
                        <td className="py-2 text-right tabular-nums font-semibold text-crimson">USD {c.price_usd.toLocaleString('es-AR')}</td>
                        <td className="py-2 text-right tabular-nums text-muted">{c.m2}</td>
                        <td className="py-2 text-right tabular-nums text-muted">{c.m2 ? Math.round(c.price_usd / c.m2).toLocaleString('es-AR') : '—'}</td>
                        <td className="py-2 pl-2 text-muted text-xs">{c.state ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(() => {
            const high = editedHigh || result.suggested_price_high_usd;
            const low = editedLow || result.suggested_price_low_usd;
            const cierre = Math.round((low + high) / 2 / 1000) * 1000;
            const fromOffer = Math.round((low * 0.95) / 1000) * 1000;
            const filteredRecs = (result.recommendations ?? []).filter(r => !/USD\s*[\d.,]+|\$\s*[\d.,]+\s*(K|mil)/i.test(r));
            const priceRecs = [
              `Publicar en USD ${high.toLocaleString('es-AR')} con margen para negociar cierre en USD ${cierre.toLocaleString('es-AR')}`,
              `Aceptar ofertas serias desde USD ${fromOffer.toLocaleString('es-AR')} si hay financiación confirmada o cierre rápido`,
            ];
            const allRecs = [...priceRecs, ...filteredRecs];
            return (
              <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-violet-900 uppercase tracking-wider mb-3">Recomendaciones para la venta</h3>
                <ul className="space-y-2">
                  {allRecs.map((r, i) => (
                    <li key={i} className="text-sm text-[#0F172A] flex gap-2">
                      <span className="text-emerald-500 flex-shrink-0">✓</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm whitespace-pre-line">{error}</div>}

          {/* CONFIRMAR — recién acá se genera el link público */}
          {!confirmedToken ? (
            <div className="bg-[#0F172A] text-white rounded-2xl p-5">
              <h3 className="text-sm font-bold mb-1">Confirmar tasación</h3>
              <p className="text-xs text-white/70 mb-4">
                Revisá el precio y, si querés ajustarlo, modificá los valores arriba. Al confirmar se genera el link público para mandarle al cliente y se habilita el PDF.
              </p>
              <button
                onClick={confirmAppraisal}
                disabled={confirming || !editedLow || !editedHigh || editedLow >= editedHigh}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {confirming ? 'Guardando…' : '✓ Confirmar y generar link'}
              </button>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <h3 className="text-sm font-bold text-emerald-900 mb-1">🔗 Tasación confirmada — link para el cliente</h3>
              <p className="text-xs text-emerald-800 mb-3">Tasación profesional con fotos, análisis y datos del asesor.</p>
              <div className="bg-white border border-emerald-200 rounded-xl p-2 mb-2">
                <code className="text-xs text-[#0F172A] break-all">{`${window.location.origin}/t/${confirmedToken}`}</code>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={async () => {
                    const url = `${window.location.origin}/t/${confirmedToken}`;
                    await navigator.clipboard.writeText(url);
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 1500);
                  }}
                  className="bg-white border border-border text-[#0F172A] py-2 rounded-lg text-sm font-medium"
                >
                  {linkCopied ? '✓ Copiado' : '📋 Copiar link'}
                </button>
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Te paso la tasación profesional de tu propiedad:\n${window.location.origin}/t/${confirmedToken}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium text-center"
                >
                  💬 Compartir WhatsApp
                </a>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              onClick={downloadPdf}
              disabled={!confirmedToken}
              className="bg-crimson hover:bg-crimson-light text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title={!confirmedToken ? 'Confirmá la tasación primero' : ''}
            >
              📄 Descargar PDF
            </button>
            <button onClick={newAppraisal} className="bg-white border border-border text-[#0F172A] py-3 rounded-xl font-medium text-sm hover:bg-bg-soft">
              + Nueva tasación
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">{title}</h3>
    {children}
  </div>
);

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-xs text-muted block mb-1">{label}{required && <span className="text-crimson"> *</span>}</span>
    {children}
  </label>
);

// Compresión client-side de imagen (max 1600px lado más largo, JPEG q=0.85)
async function compressImage(file: File): Promise<File> {
  if (file.size < 400_000 || file.type === 'image/gif') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const ratio = Math.min(1, 1600 / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
