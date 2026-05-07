import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Modal } from '../components/ui/Modal';
import { tokko } from '../services/tokko';
import {
  agentsApi,
  operationsApi,
  propertiesApi,
  pipelineApi,
  documentsApi,
  contactsLiteApi,
  DOC_CATEGORIES,
  fmtUSD,
  fmtDate,
  type ContactLite,
  type DBAgent,
  type DBDocument,
  type DBOperationEvent,
  type DBProperty,
  type OperationStatus,
  type OperationWithRefs,
  type PipelineSummary,
} from '../services/commissions';

const STATUS_LABEL: Record<OperationStatus, string> = {
  reservada: 'Reservada',
  boleto: 'Boleto firmado',
  escriturada: 'Escriturada',
  cancelada: 'Cancelada',
};

const STATUS_COLOR: Record<OperationStatus, string> = {
  reservada: 'bg-sky-100 text-sky-700 border-sky-200',
  boleto: 'bg-amber-100 text-amber-700 border-amber-200',
  escriturada: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelada: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_ORDER: OperationStatus[] = ['reservada', 'boleto', 'escriturada', 'cancelada'];

const todayISO = () => new Date().toISOString().slice(0, 10);

interface NewOpDraft {
  property_id: string;
  newPropCode: string;
  newPropAddress: string;
  newPropPrice: string;
  newPropBarrio: string;
  newPropCoverFile: File | null;
  vendedor_id: string;
  captador_id: string;
  contact_id: string;
  precio_venta_usd: string;
  fecha_reserva: string;
  monto_sena_usd: string;
  fecha_boleto: string;
  fecha_escritura: string;
  status: OperationStatus;
  notes: string;
}

const blankDraft = (): NewOpDraft => ({
  property_id: '',
  newPropCode: '',
  newPropAddress: '',
  newPropPrice: '',
  newPropBarrio: '',
  newPropCoverFile: null,
  vendedor_id: '',
  captador_id: '',
  contact_id: '',
  precio_venta_usd: '',
  fecha_reserva: '',
  monto_sena_usd: '',
  fecha_boleto: todayISO(),
  fecha_escritura: '',
  status: 'boleto',
  notes: '',
});

export default function Operations() {
  const { currentUser } = useApp();
  const isAdmin = currentUser.role === 'admin';

  const [agents, setAgents] = useState<DBAgent[]>([]);
  const [props, setProps] = useState<DBProperty[]>([]);
  const [ops, setOps] = useState<OperationWithRefs[]>([]);
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [summary, setSummary] = useState<PipelineSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<'form' | 'docs'>('form');
  const [createdOpId, setCreatedOpId] = useState<string | null>(null);
  const [createdOpDocs, setCreatedOpDocs] = useState<DBDocument[]>([]);
  const [draft, setDraft] = useState<NewOpDraft>(blankDraft());
  const [saving, setSaving] = useState(false);
  const [tokkoLookup, setTokkoLookup] = useState<{ status: 'idle' | 'searching' | 'found' | 'notfound'; cover?: string | null }>({ status: 'idle' });
  const [statusTab, setStatusTab] = useState<OperationStatus | 'all'>('all');
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [detailOp, setDetailOp] = useState<OperationWithRefs | null>(null);
  const [detailEvents, setDetailEvents] = useState<DBOperationEvent[]>([]);
  const [detailDocs, setDetailDocs] = useState<DBDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string>('boleto');
  const [uploadTitle, setUploadTitle] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const [a, p, o, s, c] = await Promise.all([
        agentsApi.list(),
        propertiesApi.list(),
        operationsApi.listWithRefs(),
        pipelineApi.summary(),
        contactsLiteApi.list(),
      ]);
      setAgents(a);
      setProps(p);
      setOps(o);
      setSummary(s);
      setContacts(c);
    } finally {
      setLoading(false);
    }
  };

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts.slice(0, 20);
    return contacts.filter(c =>
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [contacts, contactSearch]);

  useEffect(() => { void refresh(); }, []);

  const sellableAgents = useMemo(() => agents.filter(a => a.role === 'agent' && a.active), [agents]);
  const myAgentId = useMemo(() => agents.find(a => a.email === currentUser.email)?.id ?? null, [agents, currentUser.email]);

  // Auto-completar desde Tokko cuando vendedor tipea código de propiedad
  useEffect(() => {
    if (!modalOpen || modalStep !== 'form' || draft.property_id) {
      setTokkoLookup({ status: 'idle' });
      return;
    }
    const code = draft.newPropCode.trim();
    if (code.length < 3) {
      setTokkoLookup({ status: 'idle' });
      return;
    }
    setTokkoLookup({ status: 'searching' });
    const t = setTimeout(async () => {
      try {
        const found = await tokko.findByCode(code);
        if (!found) {
          setTokkoLookup({ status: 'notfound' });
          return;
        }
        // Autocompletar campos vacíos (no pisar lo que el vendedor ya tipeó manual)
        setDraft(prev => ({
          ...prev,
          newPropAddress: prev.newPropAddress || found.address,
          newPropBarrio: prev.newPropBarrio || found.location || '',
          newPropPrice: prev.newPropPrice || (found.mainPrice ? String(found.mainPrice) : ''),
          precio_venta_usd: prev.precio_venta_usd || (found.mainPrice ? String(found.mainPrice) : ''),
        }));
        setTokkoLookup({ status: 'found', cover: found.coverPhoto });
      } catch {
        setTokkoLookup({ status: 'notfound' });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [draft.newPropCode, modalOpen, modalStep, draft.property_id]);

  const filtered = useMemo(() => {
    return ops.filter(o => {
      if (statusTab !== 'all' && o.status !== statusTab) return false;
      if (filterAgent !== 'all' && o.vendedor_id !== filterAgent && o.captador_id !== filterAgent) return false;
      return true;
    });
  }, [ops, statusTab, filterAgent]);

  const summaryMap = useMemo(() => {
    const map = new Map<OperationStatus, PipelineSummary>();
    for (const s of summary) map.set(s.status, s);
    return map;
  }, [summary]);

  const totalActiveVolume = useMemo(() => {
    return filtered.reduce((s, o) => s + (o.status === 'cancelada' ? 0 : Number(o.precio_venta_usd)), 0);
  }, [filtered]);

  const openNew = () => {
    setDraft(blankDraft());
    setModalStep('form');
    setCreatedOpId(null);
    setCreatedOpDocs([]);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalStep('form');
    setCreatedOpId(null);
    setCreatedOpDocs([]);
  };

  const handleSave = async () => {
    if (isAdmin && !draft.vendedor_id) {
      alert('Elegí qué vendedor cargó la venta.');
      return;
    }
    if (!draft.precio_venta_usd) {
      alert('Cargá el precio de venta.');
      return;
    }
    if (draft.status !== 'reservada' && !draft.fecha_boleto) {
      alert('Si la operación pasó del estado "reservada", necesitamos la fecha del boleto.');
      return;
    }
    if (draft.status === 'reservada' && !draft.fecha_reserva) {
      alert('Indicá la fecha de la reserva.');
      return;
    }
    // Si NO es admin, el vendedor se setea automáticamente al usuario logueado
    const vendedorId = isAdmin ? draft.vendedor_id : (myAgentId ?? draft.vendedor_id);
    if (!vendedorId) {
      alert('No pudimos identificar tu perfil de vendedor. Avisale a Leticia.');
      return;
    }

    setSaving(true);
    try {
      let propertyId = draft.property_id;

      if (!propertyId) {
        if (!draft.newPropAddress) {
          alert('Elegí una propiedad existente o cargá la dirección de una nueva.');
          setSaving(false);
          return;
        }
        // Si encontramos la propiedad en Tokko y el vendedor no subió otra foto, usamos la de Tokko
        const tokkoCoverUrl = (tokkoLookup.status === 'found' && tokkoLookup.cover && !draft.newPropCoverFile)
          ? tokkoLookup.cover : null;

        const newProp = await propertiesApi.create({
          address: draft.newPropAddress,
          description: null,
          rooms: null,
          surface_m2: null,
          list_price_usd: draft.newPropPrice ? Number(draft.newPropPrice) : null,
          status: draft.status === 'reservada' ? 'reservada' : 'disponible',
          captador_id: draft.captador_id || null,
          fecha_consignacion: todayISO(),
          tokko_sku: draft.newPropCode || null,
          notes: null,
          barrio: draft.newPropBarrio || null,
          cover_photo_url: tokkoCoverUrl,
        });
        propertyId = newProp.id;

        // Subir foto de portada si la cargó (sobreescribe la de Tokko si la hay)
        if (draft.newPropCoverFile) {
          try {
            await propertiesApi.uploadCoverPhoto(propertyId, draft.newPropCoverFile);
          } catch (e) {
            console.error('Error subiendo foto de portada', e);
            // No bloqueamos el flujo si falla la foto
          }
        }
      }

      const newOp = await operationsApi.create({
        property_id: propertyId,
        captador_id: draft.captador_id || null,
        vendedor_id: vendedorId,
        precio_venta_usd: Number(draft.precio_venta_usd),
        fecha_boleto: draft.fecha_boleto || todayISO(),
        fecha_escritura: draft.fecha_escritura || null,
        fecha_reserva: draft.fecha_reserva || null,
        monto_sena_usd: draft.monto_sena_usd ? Number(draft.monto_sena_usd) : null,
        contact_id: draft.contact_id || null,
        status: draft.status,
        cancelled_at: null,
        cancelled_reason: null,
        // Auto-aprobado si lo carga el admin, sino queda pendiente
        approval_status: isAdmin ? 'approved' : 'pending',
        approved_by: isAdmin ? (currentUser.id ?? null) : null,
        approved_at: null, // trigger lo setea
        rejected_reason: null,
        paid_at: null,
        agency_commission_pct: 6,
        notes: draft.notes || null,
      });
      // Pasar a step 2 (docs) en vez de cerrar
      setCreatedOpId(newOp.id);
      setModalStep('docs');
      setCreatedOpDocs([]);
      await refresh();
    } catch (e) {
      console.error(e);
      alert('Error al guardar la operación: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleStepDocsUpload = async (file: File, category: string, title: string) => {
    if (!createdOpId) return;
    if (file.size > 20 * 1024 * 1024) {
      alert('El archivo supera 20MB.');
      return;
    }
    try {
      await documentsApi.upload({
        operationId: createdOpId,
        file,
        category,
        title: title || file.name,
      });
      const docs = await documentsApi.listForOperation(createdOpId);
      setCreatedOpDocs(docs);
    } catch (e) {
      alert('Error subiendo: ' + (e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar la operación? Se borran también sus comisiones asociadas.')) return;
    try {
      await operationsApi.remove(id);
      await refresh();
    } catch (e) {
      alert('No se pudo eliminar: ' + (e as Error).message);
    }
  };

  const advance = async (op: OperationWithRefs) => {
    if (op.status === 'reservada') {
      const date = prompt('Fecha del boleto (YYYY-MM-DD):', todayISO());
      if (!date) return;
      await operationsApi.update(op.id, { status: 'boleto', fecha_boleto: date });
    } else if (op.status === 'boleto') {
      const date = prompt('Fecha de escritura (YYYY-MM-DD):', todayISO());
      if (!date) return;
      await operationsApi.update(op.id, { status: 'escriturada', fecha_escritura: date });
    }
    await refresh();
  };

  const cancel = async (op: OperationWithRefs) => {
    const reason = prompt('Motivo de cancelación (opcional):', '');
    if (reason === null) return;
    await operationsApi.update(op.id, { status: 'cancelada', cancelled_reason: reason || null });
    await refresh();
  };

  const reactivate = async (op: OperationWithRefs) => {
    if (!confirm('¿Reactivar la operación? Las comisiones vuelven a contar.')) return;
    await operationsApi.update(op.id, { status: 'boleto' });
    await refresh();
  };

  const showDetail = async (op: OperationWithRefs) => {
    setDetailOp(op);
    try {
      const [ev, docs] = await Promise.all([
        operationsApi.events(op.id),
        documentsApi.listForOperation(op.id),
      ]);
      setDetailEvents(ev);
      setDetailDocs(docs);
    } catch {
      setDetailEvents([]);
      setDetailDocs([]);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!detailOp) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      alert('El archivo supera 20MB.');
      return;
    }
    setUploading(true);
    try {
      await documentsApi.upload({
        operationId: detailOp.id,
        file,
        category: uploadCategory,
        title: uploadTitle || file.name,
      });
      const docs = await documentsApi.listForOperation(detailOp.id);
      setDetailDocs(docs);
      setUploadTitle('');
      e.target.value = '';
    } catch (err) {
      alert('Error subiendo archivo: ' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDocOpen = async (d: DBDocument) => {
    const url = await documentsApi.getPublicUrl(d.file_path);
    window.open(url, '_blank');
  };

  const handleDocDelete = async (d: DBDocument) => {
    if (!confirm(`Eliminar "${d.title}"?`)) return;
    await documentsApi.remove(d);
    if (detailOp) {
      const docs = await documentsApi.listForOperation(detailOp.id);
      setDetailDocs(docs);
    }
  };

  const StatusCard = ({ status, label, color }: { status: OperationStatus; label: string; color: string }) => {
    const s = summaryMap.get(status);
    const total = s?.total ?? 0;
    const volume = s ? Number(s.volumen_usd) : 0;
    const active = statusTab === status;
    return (
      <button
        onClick={() => setStatusTab(active ? 'all' : status)}
        className={`text-left bg-white border-2 rounded-2xl p-4 transition-all ${active ? color : 'border-border hover:border-border'}`}
      >
        <div className="text-xs uppercase tracking-wider text-muted mb-1">{label}</div>
        <div className="text-2xl font-bold text-[#0F172A]">{total}</div>
        <div className="text-xs text-muted mt-0.5">{fmtUSD(volume)}</div>
      </button>
    );
  };

  return (
    <div className="p-5 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Operaciones</h1>
          <p className="text-muted text-sm mt-0.5">Pipeline de ventas — desde reserva hasta escritura</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2.5 bg-crimson hover:bg-crimson-bright text-white rounded-xl text-sm font-medium transition-all"
        >
          {isAdmin ? '+ Cargar operación' : '+ Cargar venta'}
        </button>
      </div>

      {/* Pipeline summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatusCard status="reservada" label="Reservadas" color="border-sky-400" />
        <StatusCard status="boleto" label="Boleto firmado" color="border-amber-400" />
        <StatusCard status="escriturada" label="Escrituradas" color="border-emerald-500" />
        <StatusCard status="cancelada" label="Canceladas" color="border-red-400" />
      </div>

      {/* Stats secundarias */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Volumen vista actual</div>
          <div className="text-xl font-bold text-[#0F172A]">{fmtUSD(totalActiveVolume)}</div>
        </div>
        <div className="bg-white border border-border rounded-2xl p-4">
          <div className="text-muted text-xs uppercase tracking-wider mb-1">Comisión Turdo (6%)</div>
          <div className="text-xl font-bold text-emerald-600">{fmtUSD(totalActiveVolume * 0.06)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setStatusTab('all')}
          className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${statusTab === 'all'
            ? 'bg-crimson text-white border-crimson'
            : 'bg-white text-[#0F172A] border-border hover:bg-bg-hover'}`}
        >
          Todas
        </button>
        {STATUS_ORDER.map(s => (
          <button
            key={s}
            onClick={() => setStatusTab(s)}
            className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${statusTab === s
              ? 'bg-crimson text-white border-crimson'
              : 'bg-white text-[#0F172A] border-border hover:bg-bg-hover'}`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        {isAdmin && (
          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className="bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A] ml-auto"
          >
            <option value="all">Todos los vendedores</option>
            {sellableAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-hover">
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Propiedad</th>
                <th className="px-4 py-3 font-medium">Comprador</th>
                <th className="px-4 py-3 font-medium">Captador</th>
                <th className="px-4 py-3 font-medium">Vendedor</th>
                <th className="px-4 py-3 font-medium text-right">Precio</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted text-sm">Cargando…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted text-sm">Sin operaciones en esta vista. {isAdmin && '+ Cargar operación arriba.'}</td></tr>
              )}
              {filtered.map(op => {
                const fecha = op.status === 'reservada' && op.fecha_reserva
                  ? op.fecha_reserva
                  : op.status === 'escriturada' && op.fecha_escritura
                  ? op.fecha_escritura
                  : op.fecha_boleto;
                return (
                  <tr key={op.id} className="hover:bg-bg-hover transition-colors">
                    <td className="px-4 py-3 text-sm text-[#0F172A]">{fmtDate(fecha)}</td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={() => void showDetail(op)}
                        className="text-[#0F172A] font-medium hover:text-crimson transition-colors text-left"
                      >
                        {op.property?.address ?? '—'}
                      </button>
                      {op.property?.rooms != null && (
                        <div className="text-muted text-xs">{op.property.rooms} amb{op.property.surface_m2 ? ` · ${op.property.surface_m2} m²` : ''}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {op.contact ? (
                        <div>
                          <div className="text-[#0F172A]">{op.contact.name ?? 'Sin nombre'}</div>
                          {op.contact.channel && <div className="text-muted text-[10px] uppercase tracking-wider">{op.contact.channel}</div>}
                        </div>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#0F172A]">{op.captador?.name ?? <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3 text-sm text-[#0F172A]">{op.vendedor?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-right text-[#0F172A] font-semibold tabular-nums">{fmtUSD(Number(op.precio_venta_usd))}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-block px-2 py-1 rounded-md text-xs font-medium border ${STATUS_COLOR[op.status]} w-fit`}>
                          {STATUS_LABEL[op.status]}
                        </span>
                        {op.approval_status === 'pending' && (
                          <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium border bg-amber-100 text-amber-700 border-amber-200 w-fit">⏳ Pendiente aprobación</span>
                        )}
                        {op.approval_status === 'rejected' && (
                          <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium border bg-red-100 text-red-700 border-red-200 w-fit" title={op.rejected_reason ?? ''}>✗ Rechazada</span>
                        )}
                        {op.approval_status === 'approved' && op.paid_at && (
                          <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium border bg-emerald-100 text-emerald-700 border-emerald-200 w-fit">✓ Pagada</span>
                        )}
                        {op.approval_status === 'approved' && !op.paid_at && (
                          <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium border bg-sky-100 text-sky-700 border-sky-200 w-fit">✓ Aprobada · por cobrar</span>
                        )}
                      </div>
                    </td>
                    {isAdmin ? (
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-1.5 justify-end flex-wrap">
                          {(op.status === 'reservada' || op.status === 'boleto') && (
                            <button
                              onClick={() => void advance(op)}
                              className="text-xs px-2 py-1 rounded-md text-emerald-700 hover:bg-emerald-50 border border-emerald-200"
                            >
                              {op.status === 'reservada' ? '→ Boleto' : '→ Escriturada'}
                            </button>
                          )}
                          {op.status === 'cancelada' ? (
                            <button
                              onClick={() => void reactivate(op)}
                              className="text-xs px-2 py-1 rounded-md text-sky-700 hover:bg-sky-50 border border-sky-200"
                            >
                              Reactivar
                            </button>
                          ) : (
                            <button
                              onClick={() => void cancel(op)}
                              className="text-xs px-2 py-1 rounded-md text-amber-700 hover:bg-amber-50 border border-amber-200"
                            >
                              Cancelar
                            </button>
                          )}
                          <button
                            onClick={() => void handleDelete(op.id)}
                            className="text-xs px-2 py-1 rounded-md text-red-600 hover:bg-red-50 border border-red-200"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    ) : <td />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal cargar venta */}
      <Modal open={modalOpen} onClose={closeModal} title={modalStep === 'form' ? 'Cargar operación' : '✓ Operación creada — Subí los documentos'} width="max-w-2xl">
        {modalStep === 'form' && (
        <div className="space-y-4">
          {/* Estado inicial */}
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">¿En qué estado entra?</label>
            <div className="grid grid-cols-3 gap-2">
              {(['reservada', 'boleto', 'escriturada'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraft({ ...draft, status: s })}
                  className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${draft.status === s
                    ? `${STATUS_COLOR[s]} border-current`
                    : 'bg-white text-[#475569] border-border hover:bg-bg-hover'}`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-1">
              {isAdmin
                ? (draft.status === 'reservada'
                    ? 'Sin comisiones todavía. Se generan cuando se firma el boleto y la venta queda aprobada.'
                    : 'Como admin, esta venta queda aprobada y se calculan las comisiones automáticamente.')
                : (draft.status === 'reservada'
                    ? 'Cargá la reserva. Cuando firmes el boleto, Leticia aprueba la venta.'
                    : 'La venta queda pendiente de aprobación de Leticia. Vas a recibir notificación cuando la apruebe o rechace.')
              }
            </p>
          </div>

          {/* Propiedad */}
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Propiedad</label>
            <select
              value={draft.property_id}
              onChange={(e) => setDraft({ ...draft, property_id: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
            >
              <option value="">— Cargar nueva propiedad —</option>
              {props.filter(p => p.status !== 'archivada').map(p => (
                <option key={p.id} value={p.id}>{p.address} · {p.list_price_usd ? fmtUSD(Number(p.list_price_usd)) : 'sin precio'}</option>
              ))}
            </select>
          </div>

          {!draft.property_id && (
            <div className="bg-bg-hover rounded-xl p-4 space-y-3 border border-border">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted uppercase tracking-wider font-medium">Nueva propiedad</div>
                {tokkoLookup.status === 'searching' && (
                  <div className="text-xs text-muted">Buscando en Tokko…</div>
                )}
                {tokkoLookup.status === 'found' && (
                  <div className="text-xs text-emerald-700 font-medium">✓ Encontrada en Tokko</div>
                )}
                {tokkoLookup.status === 'notfound' && draft.newPropCode.length >= 3 && (
                  <div className="text-xs text-amber-700">No la encontramos en Tokko · cargá manual</div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">Código *</label>
                  <input
                    value={draft.newPropCode}
                    onChange={(e) => setDraft({ ...draft, newPropCode: e.target.value })}
                    className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                    placeholder="Ej: TUR-1234"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted mb-1 block">Ubicación exacta *</label>
                  <input
                    value={draft.newPropAddress}
                    onChange={(e) => setDraft({ ...draft, newPropAddress: e.target.value })}
                    className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                    placeholder="Ej: Brown 1645, 3° A — MdP"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">Barrio / Zona</label>
                  <input
                    value={draft.newPropBarrio}
                    onChange={(e) => setDraft({ ...draft, newPropBarrio: e.target.value })}
                    className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                    placeholder="Centro · Plaza Mitre · etc."
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">Precio publicado USD</label>
                  <input
                    type="number"
                    value={draft.newPropPrice}
                    onChange={(e) => setDraft({ ...draft, newPropPrice: e.target.value })}
                    className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                    placeholder="143900"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Foto de portada</label>
                {tokkoLookup.status === 'found' && tokkoLookup.cover && !draft.newPropCoverFile ? (
                  <div className="flex items-center gap-3 bg-white border border-border rounded-xl p-2">
                    <img src={tokkoLookup.cover} alt="Portada Tokko" className="w-20 h-14 rounded-md object-cover" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-emerald-700 font-medium">Foto traída de Tokko</div>
                      <div className="text-[10px] text-muted">Si querés reemplazarla, subí otra acá abajo.</div>
                    </div>
                  </div>
                ) : null}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setDraft({ ...draft, newPropCoverFile: e.target.files?.[0] ?? null })}
                  className="w-full text-xs text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-crimson file:text-white hover:file:bg-crimson-bright cursor-pointer mt-2"
                />
                {draft.newPropCoverFile && (
                  <div className="text-[10px] text-muted mt-1">{draft.newPropCoverFile.name} ({Math.round(draft.newPropCoverFile.size / 1024)} KB)</div>
                )}
              </div>
            </div>
          )}

          {/* Captador y vendedor */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Captador</label>
              <select
                value={draft.captador_id}
                onChange={(e) => setDraft({ ...draft, captador_id: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              >
                <option value="">— Sin captador —</option>
                {sellableAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="text-[10px] text-muted mt-1">Quién consignó la propiedad (informativo)</p>
            </div>
            <div>
              <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Vendedor {isAdmin && '*'}</label>
              {isAdmin ? (
                <select
                  value={draft.vendedor_id}
                  onChange={(e) => setDraft({ ...draft, vendedor_id: e.target.value })}
                  className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                >
                  <option value="">— Elegir —</option>
                  {sellableAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={agents.find(a => a.id === myAgentId)?.name ?? currentUser.name ?? 'Vos'}
                  disabled
                  className="w-full bg-bg-hover border border-border rounded-xl px-3 py-2 text-sm text-muted"
                />
              )}
              <p className="text-[10px] text-muted mt-1">Cobra escalonado: 1ra 20% · 2da 25% · 3ra+ 30% sobre el 6% de Turdo</p>
            </div>
          </div>

          {/* Precio */}
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Precio venta USD *</label>
            <input
              type="number"
              value={draft.precio_venta_usd}
              onChange={(e) => setDraft({ ...draft, precio_venta_usd: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              placeholder="143900"
            />
          </div>

          {/* Fechas según estado */}
          {draft.status === 'reservada' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Fecha de reserva *</label>
                <input
                  type="date"
                  value={draft.fecha_reserva}
                  onChange={(e) => setDraft({ ...draft, fecha_reserva: e.target.value })}
                  className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Monto seña USD</label>
                <input
                  type="number"
                  value={draft.monto_sena_usd}
                  onChange={(e) => setDraft({ ...draft, monto_sena_usd: e.target.value })}
                  className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                  placeholder="5000"
                />
              </div>
            </div>
          )}
          {(draft.status === 'boleto' || draft.status === 'escriturada') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Fecha boleto *</label>
                <input
                  type="date"
                  value={draft.fecha_boleto}
                  onChange={(e) => setDraft({ ...draft, fecha_boleto: e.target.value })}
                  className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">
                  Fecha escritura {draft.status === 'boleto' && <span className="text-muted text-xs font-normal">(opcional)</span>}
                </label>
                <input
                  type="date"
                  value={draft.fecha_escritura}
                  onChange={(e) => setDraft({ ...draft, fecha_escritura: e.target.value })}
                  className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                />
              </div>
            </div>
          )}

          {/* Comprador (lead que cerró la venta) */}
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">
              Comprador <span className="text-muted text-xs">(lead que cerró la venta — opcional, sirve para trazabilidad)</span>
            </label>
            {draft.contact_id ? (
              (() => {
                const sel = contacts.find(c => c.id === draft.contact_id);
                return (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between">
                    <div className="text-sm">
                      <div className="font-medium text-emerald-900">{sel?.name ?? 'Sin nombre'}</div>
                      <div className="text-xs text-emerald-700">
                        {[sel?.channel, sel?.phone, sel?.email].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setDraft({ ...draft, contact_id: '' }); setContactSearch(''); }}
                      className="text-xs text-emerald-700 hover:text-emerald-900 px-2 py-1"
                    >
                      Cambiar
                    </button>
                  </div>
                );
              })()
            ) : (
              <div className="space-y-1.5">
                <input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
                  placeholder="Buscar contacto por nombre, teléfono o email…"
                />
                {(contactSearch.length > 0 || filteredContacts.length > 0) && (
                  <div className="max-h-48 overflow-y-auto bg-white border border-border rounded-xl divide-y divide-border">
                    {filteredContacts.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted">Sin coincidencias.</div>
                    )}
                    {filteredContacts.map(c => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => { setDraft({ ...draft, contact_id: c.id }); setContactSearch(''); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
                      >
                        <div className="font-medium text-[#0F172A]">{c.name ?? 'Sin nombre'}</div>
                        <div className="text-xs text-muted">
                          {[c.channel, c.phone, c.email].filter(Boolean).join(' · ')}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notas */}
          <div>
            <label className="text-sm font-medium text-[#0F172A] mb-1.5 block">Notas (opcional)</label>
            <input
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              placeholder="Comentarios"
            />
          </div>

          {/* Preview comisiones */}
          {draft.precio_venta_usd && Number(draft.precio_venta_usd) > 0 && draft.status !== 'reservada' && (() => {
            const precio = Number(draft.precio_venta_usd);
            const turdo = precio * 0.06;
            return (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm">
                <div className="font-medium text-emerald-800 mb-1">Comisiones (al aprobarse):</div>
                <div className="text-emerald-700 space-y-0.5">
                  <div>Turdo (6%): <span className="font-semibold">{fmtUSD(turdo)}</span></div>
                  <div className="text-xs">Vendedor (escalonado según orden de venta del mes):</div>
                  <div className="text-xs ml-3">· Si es 1ra del mes (20%): {fmtUSD(turdo * 0.20)}</div>
                  <div className="text-xs ml-3">· Si es 2da (25%): {fmtUSD(turdo * 0.25)}</div>
                  <div className="text-xs ml-3">· Si es 3ra+ (30%): {fmtUSD(turdo * 0.30)}</div>
                </div>
              </div>
            );
          })()}
          {draft.status === 'reservada' && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm text-sky-800">
              Las comisiones se van a generar automáticamente cuando avances esta operación a "Boleto firmado" y Leticia la apruebe.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={closeModal}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl border border-border text-[#475569] hover:bg-bg-hover transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl bg-crimson text-white hover:bg-crimson-bright transition-all disabled:opacity-60"
            >
              {saving ? 'Guardando…' : 'Guardar y subir docs →'}
            </button>
          </div>
        </div>
        )}

        {modalStep === 'docs' && createdOpId && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
              Operación cargada. Subí los documentos que tengas (boleto, escritura, comprobante de seña, etc.).
              No son obligatorios — podés cerrar y subirlos después desde el detalle de la operación.
            </div>

            <DocsUploadStep
              docs={createdOpDocs}
              onUpload={handleStepDocsUpload}
              onDelete={async (doc) => {
                await documentsApi.remove(doc);
                if (createdOpId) {
                  const docs = await documentsApi.listForOperation(createdOpId);
                  setCreatedOpDocs(docs);
                }
              }}
              onPreview={async (doc) => {
                const url = await documentsApi.getPublicUrl(doc.file_path);
                window.open(url, '_blank');
              }}
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm rounded-xl bg-crimson text-white hover:bg-crimson-bright transition-all"
              >
                Listo
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal detalle operación */}
      <Modal
        open={!!detailOp}
        onClose={() => { setDetailOp(null); setDetailEvents([]); setDetailDocs([]); }}
        title={detailOp?.property?.address ?? 'Operación'}
        width="max-w-3xl"
      >
        {detailOp && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-bg-hover rounded-xl p-3">
                <div className="text-xs text-muted">Estado</div>
                <span className={`inline-block px-2 py-1 rounded-md text-xs font-medium border ${STATUS_COLOR[detailOp.status]} mt-1`}>
                  {STATUS_LABEL[detailOp.status]}
                </span>
              </div>
              <div className="bg-bg-hover rounded-xl p-3">
                <div className="text-xs text-muted">Precio</div>
                <div className="font-bold text-[#0F172A] mt-1">{fmtUSD(Number(detailOp.precio_venta_usd))}</div>
              </div>
              <div className="bg-bg-hover rounded-xl p-3">
                <div className="text-xs text-muted">Captador</div>
                <div className="text-[#0F172A] mt-1">{detailOp.captador?.name ?? '—'}</div>
              </div>
              <div className="bg-bg-hover rounded-xl p-3">
                <div className="text-xs text-muted">Vendedor</div>
                <div className="text-[#0F172A] mt-1">{detailOp.vendedor?.name ?? '—'}</div>
              </div>
              {detailOp.contact && (
                <div className="bg-emerald-50 rounded-xl p-3 col-span-2 border border-emerald-200">
                  <div className="text-xs text-emerald-700 uppercase tracking-wider">Comprador (lead)</div>
                  <div className="text-emerald-900 font-medium mt-1">{detailOp.contact.name ?? 'Sin nombre'}</div>
                  <div className="text-xs text-emerald-700 mt-0.5">
                    {[detailOp.contact.channel, detailOp.contact.phone, detailOp.contact.email].filter(Boolean).join(' · ')}
                  </div>
                  {detailOp.contact.notes && (
                    <div className="text-xs text-emerald-800 mt-1 italic">{detailOp.contact.notes}</div>
                  )}
                </div>
              )}
              {detailOp.fecha_reserva && (
                <div className="bg-bg-hover rounded-xl p-3">
                  <div className="text-xs text-muted">Fecha reserva</div>
                  <div className="text-[#0F172A] mt-1">{fmtDate(detailOp.fecha_reserva)}{detailOp.monto_sena_usd ? ` · seña ${fmtUSD(Number(detailOp.monto_sena_usd))}` : ''}</div>
                </div>
              )}
              <div className="bg-bg-hover rounded-xl p-3">
                <div className="text-xs text-muted">Fecha boleto</div>
                <div className="text-[#0F172A] mt-1">{fmtDate(detailOp.fecha_boleto)}</div>
              </div>
              {detailOp.fecha_escritura && (
                <div className="bg-bg-hover rounded-xl p-3">
                  <div className="text-xs text-muted">Fecha escritura</div>
                  <div className="text-[#0F172A] mt-1">{fmtDate(detailOp.fecha_escritura)}</div>
                </div>
              )}
              {detailOp.cancelled_at && (
                <div className="bg-red-50 rounded-xl p-3 col-span-2 border border-red-200">
                  <div className="text-xs text-red-700">Cancelada</div>
                  <div className="text-red-900 mt-1 text-sm">{detailOp.cancelled_reason ?? 'Sin motivo'}</div>
                </div>
              )}
            </div>

            {detailOp.notes && (
              <div className="bg-bg-hover rounded-xl p-3">
                <div className="text-xs text-muted">Notas</div>
                <div className="text-[#0F172A] mt-1 text-sm">{detailOp.notes}</div>
              </div>
            )}

            {/* Documentos */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-[#0F172A]">Documentos</h4>
                <span className="text-xs text-muted">{detailDocs.length} archivo{detailDocs.length === 1 ? '' : 's'}</span>
              </div>

              <div className="bg-bg-hover rounded-xl p-3 space-y-2 mb-3 border border-border">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider">Categoría</label>
                    <select
                      value={uploadCategory}
                      onChange={(e) => setUploadCategory(e.target.value)}
                      className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-[#0F172A]"
                    >
                      {DOC_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider">Título (opcional)</label>
                    <input
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-[#0F172A]"
                      placeholder="Boleto firmado original"
                    />
                  </div>
                </div>
                <label className="block">
                  <input
                    type="file"
                    onChange={handleUpload}
                    disabled={uploading}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                    className="block w-full text-xs text-[#0F172A]
                      file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0
                      file:text-xs file:font-medium file:bg-crimson file:text-white
                      hover:file:bg-crimson-bright file:cursor-pointer"
                  />
                </label>
                <p className="text-[10px] text-muted">Máx 20MB. PDF, imágenes, Word, Excel.</p>
              </div>

              <div className="space-y-1.5">
                {detailDocs.length === 0 && (
                  <div className="text-muted text-xs text-center py-3">Sin documentos cargados.</div>
                )}
                {detailDocs.map(d => {
                  const cat = DOC_CATEGORIES.find(c => c.key === d.category);
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-2 bg-white border border-border rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => void handleDocOpen(d)}
                          className="text-sm text-[#0F172A] hover:text-crimson font-medium text-left truncate block w-full"
                        >
                          {d.title}
                        </button>
                        <div className="text-[10px] text-muted">
                          {cat?.label ?? d.category} · {d.file_name} {d.file_size ? `· ${(d.file_size / 1024).toFixed(0)} KB` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => void handleDocDelete(d)}
                        className="text-[10px] px-2 py-1 rounded-md text-red-600 hover:bg-red-50 border border-red-200"
                      >
                        Borrar
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Historial */}
            <div>
              <h4 className="text-sm font-semibold text-[#0F172A] mb-2">Historial</h4>
              <div className="space-y-2">
                {detailEvents.length === 0 && (
                  <div className="text-muted text-xs">Sin eventos registrados todavía.</div>
                )}
                {detailEvents.map(ev => (
                  <div key={ev.id} className="flex items-start gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-crimson mt-2 shrink-0" />
                    <div>
                      <div className="text-[#0F172A]">
                        {ev.event_type === 'created' && `Operación creada en estado "${STATUS_LABEL[ev.to_status as OperationStatus] ?? ev.to_status}"`}
                        {ev.event_type === 'status_change' && `Cambio: ${STATUS_LABEL[ev.from_status as OperationStatus] ?? ev.from_status} → ${STATUS_LABEL[ev.to_status as OperationStatus] ?? ev.to_status}`}
                      </div>
                      <div className="text-muted text-xs">{fmtDate(ev.created_at.slice(0, 10))} · {ev.created_at.slice(11, 16)} hs</div>
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

// ── Sub-componente: paso 2 de upload de docs en el modal de carga ──────────
interface DocsUploadStepProps {
  docs: DBDocument[];
  onUpload: (file: File, category: string, title: string) => Promise<void>;
  onDelete: (doc: DBDocument) => Promise<void>;
  onPreview: (doc: DBDocument) => Promise<void>;
}

function DocsUploadStep({ docs, onUpload, onDelete, onPreview }: DocsUploadStepProps) {
  const [category, setCategory] = useState<string>('boleto');
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await onUpload(file, category, title);
      setTitle('');
      e.target.value = '';
    } finally {
      setUploading(false);
    }
  };

  const docsByCategory = useMemo(() => {
    const map = new Map<string, DBDocument[]>();
    for (const d of docs) {
      const arr = map.get(d.category) ?? [];
      arr.push(d);
      map.set(d.category, arr);
    }
    return map;
  }, [docs]);

  return (
    <div className="space-y-4">
      {/* Form de upload */}
      <div className="bg-bg-hover rounded-xl p-4 space-y-3 border border-border">
        <div className="text-xs text-muted uppercase tracking-wider font-medium">Subir nuevo documento</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">Tipo</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
            >
              {DOC_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Título (opcional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-[#0F172A]"
              placeholder="Ej: Boleto firmado 04/05"
            />
          </div>
        </div>
        <input
          type="file"
          onChange={(e) => void handleFile(e)}
          disabled={uploading}
          className="w-full text-xs text-muted file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-crimson file:text-white hover:file:bg-crimson-bright disabled:opacity-50"
        />
        {uploading && <div className="text-xs text-muted">Subiendo…</div>}
      </div>

      {/* Lista de docs ya subidos en este flow */}
      {docs.length > 0 && (
        <div>
          <div className="text-xs text-muted uppercase tracking-wider font-medium mb-2">Subidos ({docs.length})</div>
          <div className="space-y-2">
            {Array.from(docsByCategory.entries()).map(([cat, list]) => {
              const label = DOC_CATEGORIES.find(c => c.key === cat)?.label ?? cat;
              return (
                <div key={cat} className="bg-white border border-border rounded-xl p-3">
                  <div className="text-xs font-semibold text-[#0F172A] mb-1.5">{label}</div>
                  <div className="space-y-1">
                    {list.map(d => (
                      <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
                        <button
                          onClick={() => void onPreview(d)}
                          className="text-[#0F172A] hover:text-crimson transition-colors text-left flex-1 truncate"
                          title={d.file_name}
                        >
                          {d.title}
                        </button>
                        <span className="text-[10px] text-muted">{d.file_size ? Math.round(d.file_size / 1024) + ' KB' : ''}</span>
                        <button
                          onClick={() => void onDelete(d)}
                          className="text-xs text-red-600 hover:bg-red-50 px-2 py-0.5 rounded"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
