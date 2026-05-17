import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sidebar, MobileNav } from './Sidebar';
import GlobalSearch from '../GlobalSearch';
import { supabase } from '../../services/supabase';

// Mantenido por compatibilidad con código viejo que importa checkSession.
// Devuelve true si hay sesión Supabase Auth válida, false si no.
// Usar asíncrona en lugar es preferido; esta versión sin auth solo lee localStorage legacy.
export const checkSession = () => {
  try {
    const raw = localStorage.getItem('crm_session');
    if (!raw) return false;
    const { exp } = JSON.parse(raw) as { exp: number };
    if (Date.now() > exp) { localStorage.removeItem('crm_session'); return false; }
    return true;
  } catch { return false; }
};

export const AppLayout = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Validar sesión Supabase Auth (asíncrono porque hay refresh de token internamente)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
      } else {
        navigate('/login', { replace: true });
      }
    });
    // Reaccionar a logout en otra tab
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') navigate('/login', { replace: true });
    });
    return () => { sub.subscription.unsubscribe(); };
  }, [navigate]);

  // Skeleton placeholder mientras valida sesión (evita flash blanco)
  if (!ready) {
    return (
      <div className="min-h-[100dvh] bg-bg-main flex items-center justify-center">
        <div className="w-12 h-12 border-3 border-crimson border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-bg-main overflow-hidden">
      <Sidebar />
      <main
        key={location.pathname}
        className="flex-1 min-w-0 h-full flex flex-col overflow-hidden page-fade-enter"
      >
        {/* Spacer notch/Dynamic Island — fuera del scroll, mismo color de fondo */}
        <div
          className="md:hidden flex-shrink-0 bg-bg-main"
          style={{ height: 'env(safe-area-inset-top)' }}
          aria-hidden="true"
        />
        {/* Contenedor scrolleable: padding-bottom = altura tab bar + safe area */}
        <div className="flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
      </main>
      <MobileNav />
      <GlobalSearch />
    </div>
  );
};
