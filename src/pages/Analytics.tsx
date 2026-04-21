import { useState } from 'react';

export default function Analytics() {
  const [metricoolUrl, setMetricoolUrl] = useState(
    localStorage.getItem('metricool_url') ?? ''
  );
  const [inputUrl, setInputUrl] = useState(metricoolUrl);
  const [editing, setEditing] = useState(!metricoolUrl);

  const handleSave = () => {
    localStorage.setItem('metricool_url', inputUrl);
    setMetricoolUrl(inputUrl);
    setEditing(false);
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Analíticas</h1>
          <p className="text-muted text-sm mt-0.5">Dashboard de métricas integrado con Metricool</p>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-xs bg-bg-input hover:bg-bg-hover border border-border rounded-lg px-3 py-1.5 text-muted hover:text-white transition-all"
        >
          ⚙ Configurar URL
        </button>
      </div>

      {editing && (
        <div className="bg-bg-card border border-border rounded-2xl p-6 mb-6">
          <h3 className="text-white font-semibold mb-2">Configurar Metricool</h3>
          <p className="text-muted text-sm mb-4">
            En Metricool, andá a <strong className="text-white">Compartir → Compartir enlace de dashboard</strong> y pegá la URL acá.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              placeholder="https://app.metricool.com/dashboard/..."
              className="flex-1 bg-bg-input border border-border rounded-xl px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-crimson"
            />
            <button
              onClick={handleSave}
              disabled={!inputUrl.trim()}
              className="px-4 py-2 text-sm bg-crimson hover:bg-crimson-light text-white rounded-xl transition-all disabled:opacity-40"
            >
              Guardar
            </button>
            {metricoolUrl && (
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-border rounded-xl hover:text-white transition-all">
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {metricoolUrl && !editing ? (
        <div className="bg-bg-card border border-border rounded-2xl overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
          <iframe
            src={metricoolUrl}
            className="w-full h-full"
            title="Metricool Dashboard"
            frameBorder="0"
            allowFullScreen
          />
        </div>
      ) : !editing ? (
        <div className="bg-bg-card border border-border rounded-2xl p-12 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h3 className="text-white font-semibold text-lg mb-2">Conectá Metricool</h3>
          <p className="text-muted text-sm max-w-sm mx-auto mb-6">
            Integrá tu dashboard de Metricool para ver métricas de Instagram, Facebook y más desde el CRM.
          </p>
          <div className="bg-bg-input border border-border rounded-xl p-4 text-left text-sm text-muted max-w-md mx-auto space-y-2">
            <p className="text-white font-medium">Cómo obtener la URL:</p>
            <p>1. Abrí Metricool y andá a tu cuenta</p>
            <p>2. Hacé clic en <strong className="text-white">Compartir</strong> (ícono de compartir)</p>
            <p>3. Activá <strong className="text-white">Compartir enlace público</strong></p>
            <p>4. Copiá el enlace y pegalo arriba</p>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="mt-6 bg-crimson hover:bg-crimson-light text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-all"
          >
            Configurar ahora
          </button>
        </div>
      ) : null}
    </div>
  );
}
