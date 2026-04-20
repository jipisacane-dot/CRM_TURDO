import { NavLink } from 'react-router-dom';
import { useApp } from '../../contexts/AppContext';

const NAV = [
  { to: '/',           icon: '⊞',  label: 'Dashboard'    },
  { to: '/inbox',      icon: '💬', label: 'Bandeja'       },
  { to: '/leads',      icon: '👥', label: 'Consultas'     },
  { to: '/properties', icon: '🏠', label: 'Propiedades'   },
  { to: '/team',       icon: '👤', label: 'Equipo'        },
];

const TurdoLogo = ({ compact = false }) => (
  <div className={`flex items-center gap-3 ${compact ? 'justify-center' : ''}`}>
    <svg width="38" height="38" viewBox="0 0 100 100" fill="none">
      <path d="M8 8 L92 8 L92 8 L55 55 L8 8Z" fill="#8B1F1F"/>
      <path d="M8 8 L55 55 L8 92 Z" fill="#9A9A9A" opacity="0.7"/>
      <circle cx="65" cy="62" r="9" fill="#8B1F1F"/>
    </svg>
    {!compact && (
      <div>
        <div className="font-bold text-white text-base leading-tight" style={{ fontFamily: 'Georgia, serif' }}>
          Turdo <span className="font-light tracking-widest text-sm">GROUP</span>
        </div>
        <div className="text-muted text-[10px] tracking-widest uppercase">Real Estate & Investments</div>
      </div>
    )}
  </div>
);

export const Sidebar = () => {
  const { unreadCount } = useApp();
  return (
    <aside className="hidden md:flex flex-col w-60 bg-bg-card border-r border-border h-screen sticky top-0 overflow-hidden">
      <div className="px-5 py-5 border-b border-border">
        <TurdoLogo />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-crimson text-white'
                  : 'text-gray-400 hover:text-white hover:bg-bg-hover'
              }`
            }
          >
            <span className="text-base w-5 text-center">{icon}</span>
            <span>{label}</span>
            {label === 'Bandeja' && unreadCount > 0 && (
              <span className="ml-auto bg-crimson-bright text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                {unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-bg-hover cursor-pointer transition-all">
          <div className="w-8 h-8 bg-crimson rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            LT
          </div>
          <div className="min-w-0">
            <div className="text-white text-sm font-medium truncate">Leticia Turdo</div>
            <div className="text-muted text-xs">Administradora</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export const MobileNav = () => {
  const { unreadCount } = useApp();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg-card border-t border-border">
      <div className="flex">
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-all relative ${
                isActive ? 'text-crimson-bright' : 'text-muted'
              }`
            }
          >
            <span className="text-lg">{icon}</span>
            <span className="truncate">{label}</span>
            {label === 'Bandeja' && unreadCount > 0 && (
              <span className="absolute top-1 right-1/4 bg-crimson-bright text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};
