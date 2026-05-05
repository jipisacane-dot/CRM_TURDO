import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!checkSession()) {
      navigate('/login', { replace: true });
    } else {
      setReady(true);
    }
  }, [navigate]);

  if (!ready) return null;

  return (
    <div className="flex min-h-[100dvh] bg-bg-main">
      <Sidebar />
      <main className="flex-1 min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 overflow-y-auto">
        {children}
      </main>
      <MobileNav />
      <GlobalSearch />
    </div>
  );
};
