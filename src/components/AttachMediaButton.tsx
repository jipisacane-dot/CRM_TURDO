import { useRef, useState } from 'react';
import { supabase } from '../services/supabase';

interface Props {
  contactId: string;
  agentId: string;
  channel: string;
  onSent: (msg: { id: string; media_url: string; media_type: string; caption?: string }) => void;
  disabled?: boolean;
}

const MAX_IMAGE_DIM = 1920;
const JPEG_QUALITY = 0.85;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// Comprime una imagen redimensionando + recodificando a JPEG.
async function compressImage(file: File): Promise<File> {
  if (file.size < 500_000 || !file.type.startsWith('image/')) return file; // archivos chicos no se comprimen
  if (file.type === 'image/gif') return file; // gif no se toca para preservar animación

  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const ratio = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
    if (ratio === 1 && file.size < 1.5_000_000) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function detectMediaType(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

export default function AttachMediaButton({ contactId, agentId, channel, onSent, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: File; objectUrl: string; type: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showMenu, setShowMenu] = useState(false);

  const onPick = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      alert(`Archivo muy grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo 50 MB.`);
      return;
    }
    setShowMenu(false);
    let processed = file;
    if (file.type.startsWith('image/')) {
      try { processed = await compressImage(file); } catch { /* ignore, use original */ }
    }
    setCaption('');
    setPreview({ file: processed, objectUrl: URL.createObjectURL(processed), type: detectMediaType(processed.type) });
  };

  const onCancel = () => {
    if (preview) URL.revokeObjectURL(preview.objectUrl);
    setPreview(null);
    setCaption('');
    setProgress(0);
  };

  const onSend = async () => {
    if (!preview) return;
    setUploading(true);
    setProgress(10);
    try {
      const ext = preview.file.name.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? '';
      const path = `${contactId}/out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const { error: upErr } = await supabase.storage.from('chat-media').upload(path, preview.file, {
        contentType: preview.file.type,
        upsert: false,
      });
      if (upErr) throw upErr;
      setProgress(60);
      const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path);
      const mediaUrl = pub.publicUrl;
      setProgress(75);

      const { data, error } = await supabase.functions.invoke('send-message', {
        body: {
          contact_id: contactId,
          content: caption.trim() || `[${preview.type}]`,
          agent_id: agentId,
          media_type: preview.type,
          media_url: mediaUrl,
          media_caption: caption.trim() || undefined,
          media_mime: preview.file.type,
          media_filename: preview.file.name,
          media_size_bytes: preview.file.size,
        },
      });
      if (error) throw error;
      setProgress(100);
      onSent({ id: data?.message?.id ?? '', media_url: mediaUrl, media_type: preview.type, caption: caption.trim() });

      if (data?.delivery && !data.delivery.ok) {
        const detail = data.delivery.error ?? '';
        alert(`Archivo guardado en el chat, pero el envío al canal falló:\n\n${detail.slice(0, 300)}`);
      }
      onCancel();
    } catch (e) {
      alert('Error al subir: ' + (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*,video/*,audio/*,application/pdf" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) void onPick(f); e.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) void onPick(f); e.target.value = ''; }} />

      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowMenu(s => !s)}
          disabled={disabled}
          title="Adjuntar foto, video, audio o documento"
          className="bg-bg-input border border-border hover:border-crimson text-muted hover:text-white px-3 py-3 rounded-xl text-sm transition-colors disabled:opacity-40"
        >
          📎
        </button>

        {showMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
            <div className="absolute bottom-full mb-2 left-0 bg-white border border-border rounded-xl shadow-xl p-1 z-50 w-44">
              <MenuItem icon="📁" label="Archivo" onClick={() => inputRef.current?.click()} />
              <MenuItem icon="📷" label="Sacar foto" onClick={() => cameraRef.current?.click()} />
            </div>
          </>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={uploading ? undefined : onCancel}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="text-base font-semibold text-[#0F172A]">Enviar {preview.type}</div>
              {!uploading && (
                <button onClick={onCancel} className="text-muted hover:text-[#0F172A]">✕</button>
              )}
            </div>
            <div className="p-4 space-y-3">
              {preview.type === 'image' && (
                <img src={preview.objectUrl} alt="preview" className="w-full max-h-[60vh] object-contain rounded-xl bg-bg-soft" />
              )}
              {preview.type === 'video' && (
                <video src={preview.objectUrl} controls className="w-full max-h-[60vh] rounded-xl bg-black" />
              )}
              {preview.type === 'audio' && (
                <audio src={preview.objectUrl} controls className="w-full" />
              )}
              {preview.type === 'document' && (
                <div className="bg-bg-soft rounded-xl p-4 text-center">
                  <div className="text-4xl mb-2">📄</div>
                  <div className="text-sm font-medium text-[#0F172A]">{preview.file.name}</div>
                  <div className="text-xs text-muted">{(preview.file.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
              )}

              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Caption opcional…"
                rows={2}
                disabled={uploading}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm text-[#0F172A] resize-none disabled:opacity-50"
              />

              {uploading && (
                <div className="bg-bg-soft rounded-full h-2 overflow-hidden">
                  <div className="bg-crimson h-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}

              <div className="flex gap-2 justify-end">
                {!uploading && (
                  <button onClick={onCancel} className="px-3 py-2 bg-white border border-border rounded-lg text-sm">
                    Cancelar
                  </button>
                )}
                <button
                  onClick={onSend}
                  disabled={uploading}
                  className="px-4 py-2 bg-crimson text-white rounded-lg text-sm disabled:opacity-50"
                >
                  {uploading ? `Enviando… ${progress}%` : `Enviar por ${channel}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const MenuItem = ({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-bg-soft text-sm text-[#0F172A] text-left"
  >
    <span>{icon}</span>
    <span>{label}</span>
  </button>
);
