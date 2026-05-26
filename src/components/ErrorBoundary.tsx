import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

// Detecta errores de chunk loading (deploy nuevo invalidó hashes mientras la pestaña estaba abierta).
function isChunkLoadError(err: Error): boolean {
  const msg = err.message || '';
  return /Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk \d+ failed|Importing a module script failed/i.test(msg);
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      const chunkErr = isChunkLoadError(this.state.error);
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="bg-red-900/20 border border-red-800/40 rounded-2xl p-6 max-w-md text-center">
            <div className="text-red-400 text-2xl mb-3">⚠</div>
            <div className="text-white font-semibold mb-2">Algo salió mal</div>
            <div className="text-muted text-sm mb-4">
              {chunkErr
                ? 'Hay una versión nueva del CRM. Recargá la página para usarla.'
                : this.state.error.message}
            </div>
            <button
              onClick={() => (chunkErr ? window.location.reload() : this.setState({ error: null }))}
              className="px-4 py-2 bg-crimson hover:bg-crimson-light text-white rounded-xl text-sm transition-all"
            >
              {chunkErr ? 'Recargar página' : 'Reintentar'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
