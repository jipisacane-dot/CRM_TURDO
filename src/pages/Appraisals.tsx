import { useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { appraisalsApi, type PropertyInput, type AppraisalResult } from '../services/appraisals';
import { generateAppraisalPdf } from '../services/appraisalPdf';
import PageHeader from '../components/ui/PageHeader';

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
    notes: '',
  });
  const [client, setClient] = useState({ name: '', email: '', phone: '' });
  const [result, setResult] = useState<AppraisalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleAmenity = (key: string) => {
    setProperty(p => ({
      ...p,
      amenities: p.amenities?.includes(key)
        ? p.amenities.filter(a => a !== key)
        : [...(p.amenities ?? []), key],
    }));
  };

  const submit = async () => {
    if (!property.address.trim()) {
      setError('La dirección es obligatoria.');
      return;
    }
    setError(null);
    setStep('loading');
    try {
      const r = await appraisalsApi.create({
        property,
        client: client.name || client.phone ? client : undefined,
        agent_id: currentUser.id,
        agent_email: currentUser.email,
      });
      setResult(r);
      setStep('result');
    } catch (e) {
      setError((e as Error).message);
      setStep('form');
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
      suggested_price_low_usd: result.suggested_price_low_usd,
      suggested_price_high_usd: result.suggested_price_high_usd,
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
    setError(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl">
      <PageHeader
        title="Tasación de propiedad"
        subtitle="Completá los datos del depto y la IA arma una tasación profesional con comparables del mercado actual + PDF listo para mandar al cliente."
      />

      {step === 'form' && (
        <div className="bg-white border border-border rounded-2xl p-5 md:p-6 space-y-5">
          {/* Sección: ubicación */}
          <Section title="Ubicación">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Dirección *" required>
                <input
                  value={property.address}
                  onChange={e => setProperty(p => ({ ...p, address: e.target.value }))}
                  placeholder="Av. Colón 2300, Piso 5° E"
                  className="input"
                />
              </Field>
              <Field label="Barrio / Zona">
                <input
                  value={property.barrio ?? ''}
                  onChange={e => setProperty(p => ({ ...p, barrio: e.target.value }))}
                  placeholder="Plaza Mitre"
                  className="input"
                />
              </Field>
            </div>
          </Section>

          <Section title="Características">
            <div className="grid md:grid-cols-3 gap-3">
              <Field label="Ambientes">
                <input type="number" value={property.rooms ?? ''}
                  onChange={e => setProperty(p => ({ ...p, rooms: e.target.value ? +e.target.value : undefined }))}
                  className="input" />
              </Field>
              <Field label="Dormitorios">
                <input type="number" value={property.bedrooms ?? ''}
                  onChange={e => setProperty(p => ({ ...p, bedrooms: e.target.value ? +e.target.value : undefined }))}
                  className="input" />
              </Field>
              <Field label="m² cubiertos">
                <input type="number" value={property.surface_m2 ?? ''}
                  onChange={e => setProperty(p => ({ ...p, surface_m2: e.target.value ? +e.target.value : undefined }))}
                  className="input" />
              </Field>
              <Field label="Antigüedad (años)">
                <input type="number" value={property.age_years ?? ''}
                  onChange={e => setProperty(p => ({ ...p, age_years: e.target.value ? +e.target.value : undefined }))}
                  className="input" />
              </Field>
              <Field label="Piso">
                <input type="number" value={property.floor_number ?? ''}
                  onChange={e => setProperty(p => ({ ...p, floor_number: e.target.value ? +e.target.value : undefined }))}
                  className="input" />
              </Field>
              <Field label="Orientación">
                <select value={property.exposure ?? ''}
                  onChange={e => setProperty(p => ({ ...p, exposure: e.target.value as PropertyInput['exposure'] || undefined }))}
                  className="input">
                  {EXPOSURES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              <Field label="Estado">
                <select value={property.property_state ?? ''}
                  onChange={e => setProperty(p => ({ ...p, property_state: e.target.value as PropertyInput['property_state'] || undefined }))}
                  className="input">
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
                  className="input">
                  {VIEWS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Expensas (ARS/mes)">
                <input type="number" value={property.expenses_ars ?? ''}
                  onChange={e => setProperty(p => ({ ...p, expenses_ars: e.target.value ? +e.target.value : undefined }))}
                  className="input" />
              </Field>
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
              className="input resize-none"
            />
          </Section>

          <Section title="Cliente / propietario (opcional)">
            <div className="grid md:grid-cols-3 gap-3">
              <Field label="Nombre">
                <input value={client.name} onChange={e => setClient(c => ({ ...c, name: e.target.value }))} className="input" />
              </Field>
              <Field label="Teléfono">
                <input value={client.phone} onChange={e => setClient(c => ({ ...c, phone: e.target.value }))} className="input" inputMode="tel" />
              </Field>
              <Field label="Email">
                <input value={client.email} onChange={e => setClient(c => ({ ...c, email: e.target.value }))} className="input" inputMode="email" />
              </Field>
            </div>
          </Section>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

          <button
            onClick={submit}
            disabled={!property.address.trim()}
            className="w-full bg-crimson hover:bg-crimson-light text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            ✨ Generar tasación con IA
          </button>
          <p className="text-xs text-muted text-center">
            La IA tarda 5-10 segundos. Después podés descargar el PDF profesional listo para enviar.
          </p>
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
          {/* Hero del resultado */}
          <div className="bg-gradient-to-br from-crimson to-[#A52828] rounded-2xl p-6 text-white">
            <div className="text-xs uppercase tracking-wider opacity-80">Precio sugerido</div>
            <div className="text-3xl md:text-4xl font-bold mt-2 tabular-nums">
              USD {result.suggested_price_low_usd.toLocaleString('es-AR')} — USD {result.suggested_price_high_usd.toLocaleString('es-AR')}
            </div>
            {result.estimated_sale_days > 0 && (
              <div className="text-sm mt-2 opacity-90">
                Tiempo estimado de venta: {result.estimated_sale_days} días
              </div>
            )}
          </div>

          <div className="bg-white border border-border rounded-2xl p-5">
            <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider mb-2">Análisis</h3>
            <p className="text-sm text-[#0F172A] leading-relaxed">{result.ai_reasoning}</p>
          </div>

          {result.market_summary && (
            <div className="bg-white border border-border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider mb-2">Mercado</h3>
              <p className="text-sm text-[#0F172A] leading-relaxed">{result.market_summary}</p>
            </div>
          )}

          {result.comparables.length > 0 && (
            <div className="bg-white border border-border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider mb-3">Propiedades comparables ({result.comparables.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted uppercase">
                      <th className="text-left py-2">Dirección</th>
                      <th className="text-right py-2">Precio</th>
                      <th className="text-right py-2">m²</th>
                      <th className="text-right py-2">Amb</th>
                      <th className="text-left py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.comparables.map((c, i) => (
                      <tr key={i}>
                        <td className="py-2 text-[#0F172A]">{c.address}</td>
                        <td className="py-2 text-right tabular-nums font-semibold text-crimson">USD {c.price_usd.toLocaleString('es-AR')}</td>
                        <td className="py-2 text-right tabular-nums text-muted">{c.m2}</td>
                        <td className="py-2 text-right tabular-nums text-muted">{c.rooms ?? '—'}</td>
                        <td className="py-2 text-muted text-xs">{c.state ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.recommendations.length > 0 && (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-violet-900 uppercase tracking-wider mb-3">Recomendaciones</h3>
              <ul className="space-y-2">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="text-sm text-[#0F172A] flex gap-2">
                    <span className="text-emerald-500 flex-shrink-0">✓</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sticky bottom-4">
            <button onClick={downloadPdf} className="bg-crimson hover:bg-crimson-light text-white py-3 rounded-xl font-semibold text-sm">
              📄 Descargar PDF
            </button>
            <button onClick={newAppraisal} className="bg-white border border-border text-[#0F172A] py-3 rounded-xl font-medium text-sm hover:bg-bg-soft">
              + Nueva tasación
            </button>
          </div>
        </div>
      )}

      <style>{`
        .input {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border: 1px solid #E2E8F0;
          border-radius: 0.625rem;
          font-size: 0.875rem;
          color: #0F172A;
          background: white;
          outline: none;
        }
        .input:focus { border-color: #8B1F1F; }
      `}</style>
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
