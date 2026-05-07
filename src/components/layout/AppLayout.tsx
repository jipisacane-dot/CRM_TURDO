import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sidebar, MobileNav } from './Sidebar';
import GlobalSearch from '../GlobalSearch';

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
    if (!checkSession()) {
      navigate('/login', { replace: true });
    } else {
      setReady(true);
    }
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
    <div className="flex h-[100dvh] bg-bg-main overflow-hidden">
      <Sidebar />
      <main
        key={location.pathname}
        className="flex-1 min-w-0 h-full overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 page-fade-enter"
      >
        {children}
      </main>
      <MobileNav />
      <GlobalSearch />
    </div>
  );
};
