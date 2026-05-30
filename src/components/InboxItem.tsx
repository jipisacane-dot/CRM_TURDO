import { memo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { CornerUpRight } from 'lucide-react';
import { ChannelIcon } from './ui/ChannelIcon';
import QualityBadge from './ui/QualityBadge';
import type { Lead } from '../types';

interface Props {
  lead: Lead;
  isSelected: boolean;
  unread: number;
  agentName?: string;
  onSelect: (id: string) => void;
}

function LeadAvatar({ lead }: { lead: Lead }) {
  if (lead.avatarUrl) {
    return (
      <img
        src={lead.avatarUrl}
        alt={lead.name}
        className="w-11 h-11 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <div className="w-11 h-11 rounded-full bg-crimson/15 border border-crimson/25 flex items-center justify-center text-sm font-semibold text-crimson">
      {lead.name.charAt(0).toUpperCase()}
    </div>
  );
}

function InboxItemBase({ lead, isSelected, unread, agentName, onSelect }: Props) {
  const last = lead.messages[lead.messages.length - 1];

  return (
    <div
      onClick={() => onSelect(lead.id)}
      className={`flex gap-3 px-4 py-3 border-b border-border cursor-pointer transition-colors active:bg-bg-hover ${
        isSelected ? 'bg-crimson-50 border-l-[3px] border-l-crimson pl-[13px]' : 'hover:bg-bg-hover'
      }`}
      style={{ contain: 'layout style paint' }}
    >
      <div className="relative flex-shrink-0">
        <LeadAvatar lead={lead} />
        <div className="absolute -bottom-0.5 -right-0.5">
          <ChannelIcon channel={lead.channel} size="sm" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-sm truncate ${unread > 0 ? 'font-semibold text-[#0F172A]' : 'font-medium text-slate-600'}`}>
              {lead.name}
            </span>
            <QualityBadge lead={lead} size="sm" />
          </div>
          <span className="text-muted text-[10px] flex-shrink-0">
            {formatDistanceToNow(new Date(lead.lastActivity), { locale: es, addSuffix: false })}
          </span>
        </div>
        {(lead.phone || lead.email) && (
          <div className="text-muted text-[10px] font-mono truncate mt-0.5">
            {lead.phone || lead.email}
          </div>
        )}
        <div className="flex items-center gap-1 mt-0.5">
          <ChannelIcon channel={lead.channel} size="sm" />
          {agentName ? (
            <span className="text-muted text-xs truncate">{agentName.split(' ')[0]}</span>
          ) : (
            <span className="text-crimson-bright text-xs">Sin asignar</span>
          )}
        </div>
        {last && (
          <div className={`text-xs truncate mt-0.5 flex items-center gap-1 ${unread > 0 ? 'text-slate-600 font-medium' : 'text-muted'}`}>
            {last.direction === 'out' && <CornerUpRight size={12} className="flex-shrink-0 opacity-70" />}
            <span className="truncate">{last.content}</span>
          </div>
        )}
      </div>
      {unread > 0 && (
        <span className="bg-crimson-bright text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 self-start mt-1">
          {unread}
        </span>
      )}
    </div>
  );
}

// React.memo: este componente SOLO re-renderiza si sus props cambian.
// Cuando el filtro o el search cambian, los items que no se vieron afectados
// (mismo lead, mismo unread, mismo isSelected) no se vuelven a renderizar.
// Eso es CRÍTICO para que la lista de 1500+ items sea fluida.
export const InboxItem = memo(InboxItemBase, (prev, next) => {
  return (
    prev.lead === next.lead &&
    prev.isSelected === next.isSelected &&
    prev.unread === next.unread &&
    prev.agentName === next.agentName &&
    prev.onSelect === next.onSelect
  );
});
