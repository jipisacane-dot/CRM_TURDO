import { useState, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { useNavigate } from 'react-router-dom';
import { AGENTS } from '../data/mock';
import { ChannelIcon } from '../components/ui/ChannelIcon';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Lead } from '../types';
import { supabase } from '../services/supabase';

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  contacted: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  qualified: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  proposal: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  visit: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  won: 'bg-green-500/20 text-green-400 border-green-500/30',
  lost: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const statusLabel: Record<string, string> = {
  new: 'Nuevo', contacted: 'Contactado', qualified: 'Calificado',
  proposal: 'Propuesta', visit: 'Visita', won: 'Ganado', lost: 'Perdido',
};

function ContactAvatar({ lead }: { lead: Lead }) {
  const [imgError, setImgError] = useState(false);
  if (lead.avatarUrl && !imgError) {
    return (
      <img
        src={lead.avatarUrl}
        alt={lead.name}
        onError={() => setImgError(true)}
        className="w-10 h-10 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-crimson/20 border border-crimson/30 flex items-center justify-center text-sm font-semibold text-crimson">
      {lead.name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function Contacts() {
  const { leads, refreshLeads, loading, currentUser } = useApp();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = currentUser.role === 'admin';
  // Vendedores filtran por currentUser.dbId (UUID real), NO por currentUser.id (mock string)
  const scope = isAdmin ? leads : leads.filter(l => currentUser.dbId && l.assignedTo === currentUser.dbId);

  const filtered = scope
    .filter(l => statusFilter === 'all' || l.status === statusFilter)
    .filter(l => channelFilter === 'all' || l.channel === channelFilter)
    .filter(l => {
      if (!search) return true;
      const s = search.toLowerCase();
      return l.name.toLowerCase().includes(s) ||
        l.phone?.includes(s) ||
        l.email?.toLowerCase().includes(s);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);

    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));

    const idx = {
      name: headers.findIndex(h => ['nombre', 'name', 'contacto'].includes(h)),
      phone: headers.findIndex(h => ['telefono', 'teléfono', 'phone', 'tel', 'celular'].includes(h)),
      email: headers.findIndex(h => ['email', 'correo', 'mail'].includes(h)),
      notes: headers.findIndex(h => ['consulta', 'mensaje', 'notes', 'nota'].includes(h)),
    };

    let ok = 0, errors = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const name = idx.name >= 0 ? cols[idx.name] : '';
      const phone = idx.phone >= 0 ? cols[idx.phone] : '';
      const email = idx.email >= 0 ? cols[idx.email] : '';
      const notes = idx.notes >= 0 ? cols[idx.notes] : '';
      if (!name && !phone && !email) continue;

      const { error } = await supabase.from('contacts').insert({
        name: name || 'Sin nombre',
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        channel: 'web',
        status: 'new',
        branch: 'Corrientes',
      });
      if (error) errors++; else ok++;
    }

    setImportResult({ ok, errors });
    setImporting(false);
    await refreshLeads();
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="flex flex-col h-full p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Contactos</h1>
          <p className="text-muted text-sm mt-0.5">{leads.length} contactos en total</p>
        </div>
        <div className="flex gap-3">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleImport} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-white hover:bg-bg-hover transition-all disabled:opacity-50"
          >
            <span>⬆</span>
            {importing ? 'Importando...' : 'Importar CSV'}
          </button>
        </div>
      </div>

      {importResult && (
        <div className={`px-4 py-3 rounded-xl border text-sm ${importResult.errors === 0 ? 'bg-green-900/20 border-green-800/40 text-green-400' : 'bg-yellow-900/20 border-yellow-800/40 text-yellow-400'}`}>
          ✓ {importResult.ok} contactos importados{importResult.errors > 0 ? ` · ${importResult.errors} errores` : ''}
          <button onClick={() => setImportResult(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, teléfono o email..."
          className="flex-1 min-w-64 bg-bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted outline-none focus:border-crimson"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-bg-input border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-crimson"
        >
          <option value="all">Todos los estados</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select
          value={channelFilter}
          onChange={e => setChannelFilter(e.target.value)}
          className="bg-bg-input border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-crimson"
        >
          <option value="all">Todos los canales</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="web">Web</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 bg-bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-muted font-medium uppercase tracking-wider">Contacto</th>
                <th className="text-left px-4 py-3 text-xs text-muted font-medium uppercase tracking-wider">Teléfono</th>
                <th className="text-left px-4 py-3 text-xs text-muted font-medium uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-xs text-muted font-medium uppercase tracking-wider">Canal</th>
                <th className="text-left px-4 py-3 text-xs text-muted font-medium uppercase tracking-wider">Estado</th>
                <th className="text-left px-4 py-3 text-xs text-muted font-medium uppercase tracking-wider">Asesor</th>
                <th className="text-left px-4 py-3 text-xs text-muted font-medium uppercase tracking-wider">Ingresó</th>
                <th className="text-left px-4 py-3 text-xs text-muted font-medium uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center py-12 text-muted text-sm animate-pulse">Cargando contactos...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-muted text-sm">No se encontraron contactos</td></tr>
              )}
              {filtered.map(lead => {
                const agent = lead.assignedTo ? AGENTS.find(a => a.id === lead.assignedTo) : null;
                return (
                  <tr key={lead.id} className="border-b border-border/50 hover:bg-bg-hover/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ContactAvatar lead={lead} />
                        <div>
                          <div className="text-white text-sm font-medium">{lead.name}</div>
                          {lead.propertyTitle && <div className="text-muted text-xs truncate max-w-40">{lead.propertyTitle}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">{lead.phone ?? <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-300 max-w-40 truncate">{lead.email ?? <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3">
                      <ChannelIcon channel={lead.channel} size="sm" showLabel />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusColors[lead.status]}`}>
                        {statusLabel[lead.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {agent ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-crimson/20 border border-crimson/30 flex items-center justify-center text-xs text-crimson font-semibold">
                            {agent.name.charAt(0)}
                          </div>
                          <span className="text-xs">{agent.name.split(' ')[0]}</span>
                        </div>
                      ) : <span className="text-crimson text-xs">Sin asignar</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {formatDistanceToNow(new Date(lead.createdAt), { locale: es, addSuffix: true })}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate('/inbox')}
                        className="text-xs px-3 py-1.5 bg-crimson/10 hover:bg-crimson/20 text-crimson border border-crimson/30 rounded-lg transition-all"
                      >
                        Ver chat
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* CSV format hint */}
      <p className="text-muted text-xs">
        Formato CSV para importar: columnas <code className="text-crimson">nombre, telefono, email, consulta</code> (encabezados en la primera fila)
      </p>
    </div>
  );
}
