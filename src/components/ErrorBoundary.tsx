import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="bg-red-900/20 border border-red-800/40 rounded-2xl p-6 max-w-md text-center">
            <div className="text-red-400 text-2xl mb-3">⚠</div>
            <div className="text-white font-semibold mb-2">Algo salió mal</div>
            <div className="text-muted text-sm mb-4">{this.state.error.message}</div>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 bg-crimson hover:bg-crimson-light text-white rounded-xl text-sm transition-all"
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
