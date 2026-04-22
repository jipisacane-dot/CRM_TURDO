import type { Channel } from '../../types';

const cfg: Record<Channel, { label: string; color: string; dot: string }> = {
  whatsapp:     { label: 'WhatsApp',     color: '#15803D', dot: '#22C55E' },
  instagram:    { label: 'Instagram',    color: '#9D174D', dot: '#EC4899' },
  facebook:     { label: 'Facebook',     color: '#1D4ED8', dot: '#3B82F6' },
  email:        { label: 'Email',        color: '#B45309', dot: '#F59E0B' },
  web:          { label: 'Web',          color: '#374151', dot: '#9CA3AF' },
  zonaprop:     { label: 'ZonaProp',     color: '#92400E', dot: '#F97316' },
  argenprop:    { label: 'Argenprop',    color: '#166534', dot: '#4ADE80' },
  mercadolibre: { label: 'MercadoLibre', color: '#713F12', dot: '#EAB308' },
};

interface Props {
  channel: Channel;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export const ChannelIcon = ({ channel, size = 'md', showLabel = false }: Props) => {
  const c = cfg[channel] ?? { label: channel, color: '#6B7280', dot: '#9CA3AF' };
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : size === 'lg' ? 'w-2.5 h-2.5' : 'w-2 h-2';
  const textSize = size === 'sm' ? 'text-[10px]' : size === 'lg' ? 'text-sm' : 'text-xs';

  return (
    <span className={`inline-flex items-center gap-1 font-medium ${textSize}`} style={{ color: c.color }}>
      <span className={`${dotSize} rounded-full flex-shrink-0`} style={{ background: c.dot }} />
      {showLabel && <span>{c.label}</span>}
      {!showLabel && size !== 'sm' && <span>{c.label}</span>}
    </span>
  );
};

export const channelLabel = (ch: Channel) => cfg[ch]?.label ?? ch;
export const channelColor  = (ch: Channel) => cfg[ch]?.color ?? '#6B7280';
