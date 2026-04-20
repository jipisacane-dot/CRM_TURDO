import type { Channel } from '../../types';

const icons: Record<Channel, { icon: string; color: string; bg: string; label: string }> = {
  whatsapp:     { icon: '💬', color: '#25D366', bg: '#25D36620', label: 'WhatsApp' },
  instagram:    { icon: '📸', color: '#E1306C', bg: '#E1306C20', label: 'Instagram' },
  facebook:     { icon: '👤', color: '#1877F2', bg: '#1877F220', label: 'Facebook' },
  email:        { icon: '✉️', color: '#EA4335', bg: '#EA433520', label: 'Email' },
  web:          { icon: '🌐', color: '#8B8B8B', bg: '#8B8B8B20', label: 'Web' },
  zonaprop:     { icon: '🏠', color: '#F5A623', bg: '#F5A62320', label: 'ZonaProp' },
  argenprop:    { icon: '🏡', color: '#4CAF50', bg: '#4CAF5020', label: 'Argenprop' },
  mercadolibre: { icon: '🛍️', color: '#FFE600', bg: '#FFE60020', label: 'MercadoLibre' },
};

interface Props {
  channel: Channel;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export const ChannelIcon = ({ channel, size = 'md', showLabel = false }: Props) => {
  const cfg = icons[channel];
  const px = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2 py-1 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${px}`}
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <span>{cfg.icon}</span>
      {showLabel && <span>{cfg.label}</span>}
    </span>
  );
};

export const channelLabel = (ch: Channel) => icons[ch]?.label ?? ch;
export const channelColor = (ch: Channel) => icons[ch]?.color ?? '#888';
