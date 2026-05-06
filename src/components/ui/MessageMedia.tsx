import type { Message } from '../../types';

interface Props {
  message: Pick<Message, 'media_type' | 'media_url' | 'media_caption' | 'media_mime' | 'media_filename' | 'media_size_bytes' | 'content'>;
  onOpenLightbox?: (url: string) => void;
}

export default function MessageMedia({ message, onOpenLightbox }: Props) {
  const { media_type, media_url, media_caption, media_filename, media_size_bytes, media_mime } = message;
  if (!media_type || !media_url) return null;

  const sizeStr = media_size_bytes ? formatBytes(media_size_bytes) : null;

  if (media_type === 'image' || media_type === 'sticker') {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => onOpenLightbox?.(media_url)}
          className="block max-w-[280px] rounded-xl overflow-hidden hover:opacity-90 transition-opacity"
        >
          <img
            src={media_url}
            alt={media_caption ?? 'Imagen'}
            loading="lazy"
            className="w-full h-auto object-cover max-h-[320px]"
          />
        </button>
        {media_caption && <div className="text-sm whitespace-pre-wrap">{media_caption}</div>}
      </div>
    );
  }

  if (media_type === 'video') {
    return (
      <div className="space-y-1">
        <video
          src={media_url}
          controls
          preload="metadata"
          className="max-w-[280px] max-h-[320px] rounded-xl bg-black"
        />
        {media_caption && <div className="text-sm whitespace-pre-wrap">{media_caption}</div>}
      </div>
    );
  }

  if (media_type === 'audio') {
    return (
      <div className="bg-black/5 rounded-xl px-3 py-2 max-w-[280px]">
        <audio src={media_url} controls preload="metadata" className="w-full" />
        {sizeStr && <div className="text-[10px] text-muted mt-1">🎵 {sizeStr}</div>}
      </div>
    );
  }

  if (media_type === 'document') {
    return (
      <a
        href={media_url}
        target="_blank"
        rel="noreferrer"
        download={media_filename ?? undefined}
        className="flex items-center gap-3 bg-black/5 hover:bg-black/10 rounded-xl px-3 py-2 max-w-[280px] transition-colors"
      >
        <div className="text-2xl flex-shrink-0">📄</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{media_filename ?? 'Documento'}</div>
          <div className="text-[10px] text-muted">
            {[media_mime?.split('/')?.[1]?.toUpperCase(), sizeStr].filter(Boolean).join(' · ')}
          </div>
        </div>
      </a>
    );
  }

  // Fallback genérico
  return (
    <a href={media_url} target="_blank" rel="noreferrer" className="text-xs underline">
      📎 Adjunto
    </a>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
