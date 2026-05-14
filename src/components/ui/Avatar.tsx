const colors = [
  'bg-red-700', 'bg-blue-700', 'bg-green-700', 'bg-yellow-700',
  'bg-purple-700', 'bg-pink-700', 'bg-indigo-700', 'bg-teal-700',
];

const getColor = (initials: string) =>
  colors[initials.charCodeAt(0) % colors.length];

interface Props {
  initials: string;
  imageUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  online?: boolean;
}

export const Avatar = ({ initials, imageUrl, size = 'md', online }: Props) => {
  const dim = { xs: 'w-6 h-6 text-xs', sm: 'w-8 h-8 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-11 h-11 text-base' }[size];
  return (
    <div className="relative inline-flex">
      {imageUrl ? (
        <img src={imageUrl}
          alt={initials}
          loading="lazy"
          decoding="async"
          className={`${dim} rounded-full object-cover flex-shrink-0`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className={`${dim} ${getColor(initials)} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`}>
          {initials}
        </div>
      )}
      {online !== undefined && (
        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-bg-card ${online ? 'bg-green-400' : 'bg-gray-500'}`} />
      )}
    </div>
  );
};
