import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../../contexts/AppContext';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useRegisterSW } from 'virtual:pwa-register/react';

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ICONS = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  inbox:     'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  contacts:  'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  leads:     'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  properties:'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  team:      'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  calendar:  'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  analytics: 'M18 20V10M12 20V4M6 20v-6',
  bell:      'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  logout:    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  refresh:   'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
};

const NAV = [
  { to: '/',           iconKey: 'dashboard',   label: 'Dashboard'  },
  { to: '/inbox',      iconKey: 'inbox',       label: 'Bandeja'    },
  { to: '/contacts',   iconKey: 'contacts',    label: 'Contactos'  },
  { to: '/leads',      iconKey: 'leads',       label: 'Consultas'  },
  { to: '/properties', iconKey: 'properties',  label: 'Propiedades'},
  { to: '/team',       iconKey: 'team',        label: 'Equipo'     },
  { to: '/calendar',   iconKey: 'calendar',    label: 'Calendario' },
  { to: '/analytics',  iconKey: 'analytics',   label: 'Analíticas' },
] as const;

const TurdoLogo = ({ compact = false }) => (
  <div className={`flex items-center gap-3 ${compact ? 'justify-center' : ''}`}>
    <svg width="32" height="32" viewBox="0 0 100 100" fill="none">
      <path d="M8 8 L92 8 L55 55 L8 8Z" fill="#8B1F1F"/>
      <path d="M8 8 L55 55 L8 92 Z" fill="#C4C4C4" opacity="0.5"/>
      <circle cx="65" cy="62" r="9" fill="#8B1F1F"/>
    </svg>
    {!compact && (
      <div>
        <div className="font-semibold text-[#0F172A] text-sm tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
          Turdo <span className="font-light tracking-widest text-xs text-muted">GROUP</span>
        </div>
        <div className="text-muted text-[9px] tracking-widest uppercase">Real Estate</div>
      </div>
    )}
  </div>
);

export const Sidebar = () => {
  const { unreadCount, dueReminders } = useApp();
  const navigate = useNavigate();
  const { status: pushStatus, loading: pushLoading, subscribe, unsubscribe } = usePushNotifications();
  const { needRefresh, updateServiceWorker } = useRegisterSW();

  const handleLogout = () => {
    localStorage.removeItem('crm_session');
    navigate('/login', { replace: true });
  };

  return (
    <aside className="hidden md:flex flex-col w-56 bg-white border-r border-border h-screen sticky top-0 overflow-hidden">
      <div className="px-5 py-5 border-b border-border">
        <TurdoLogo />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, iconKey, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-crimson text-white [&>svg]:stroke-white'
                  : 'text-[#475569] hover:text-[#0F172A] hover:bg-bg-hover'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'text-white' : 'text-muted'}>
                  <Icon d={ICONS[iconKey]} size={15} />
                </span>
                <span>{label}</span>
                {label === 'Bandeja' && (unreadCount > 0 || dueReminders.length > 0) && (
                  <span className="ml-auto flex items-center gap-1">
                    {unreadCount > 0 && (
                      <span className="bg-crimson-bright text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                        {unreadCount}
                      </span>
                    )}
                    {dueReminders.length > 0 && (
                      <span className="bg-amber-400 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                        {dueReminders.length}
                      </span>
                    )}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-border space-y-1">

        {needRefresh && (
          <button
            onClick={() => updateServiceWorker(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-crimson/5 text-crimson border border-crimson/15 hover:bg-crimson/10 transition-all mb-1"
          >
            <Icon d={ICONS.refresh} size={13} />
            Nueva versión disponible
          </button>
        )}

        {pushStatus !== 'unsupported' && (
          <button
            onClick={pushStatus === 'subscribed' ? unsubscribe : subscribe}
            disabled={pushLoading || pushStatus === 'denied'}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all mb-1 ${
              pushStatus === 'subscribed'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                : pushStatus === 'denied'
                ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
            }`}
          >
            <Icon d={ICONS.bell} size={13} />
            {pushLoading ? 'Configurando...' :
             pushStatus === 'subscribed' ? 'Notificaciones activas' :
             pushStatus === 'denied' ? 'Notificaciones bloqueadas' :
             'Activar notificaciones'}
          </button>
        )}

        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-hover cursor-pointer transition-all">
          <div className="w-7 h-7 bg-crimson rounded-full flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0">
            LT
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[#0F172A] text-sm font-medium truncate">Leticia Turdo</div>
            <div className="text-muted text-xs">Administradora</div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-red-500 hover:bg-bg-hover transition-all"
        >
          <Icon d={ICONS.logout} size={15} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
};

export const MobileNav = () => {
  const { unreadCount, dueReminders } = useApp();
  const MOBILE_NAV = NAV.slice(0, 5);
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-border">
      <div className="flex">
        {MOBILE_NAV.map(({ to, iconKey, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-all relative ${
                isActive ? 'text-crimson' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'text-crimson' : 'text-muted'}>
                  <Icon d={ICONS[iconKey]} size={18} />
                </span>
                <span>{label}</span>
                {label === 'Bandeja' && (unreadCount > 0 || dueReminders.length > 0) && (
                  <span className="absolute top-1.5 right-1/4 bg-crimson-bright text-white text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-1">
                    {unreadCount + dueReminders.length}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};
