// Grabación de notas de voz desde el navegador con MediaRecorder API.
// Tap para arrancar, tap de nuevo para parar. Después modal preview + caption + enviar.
// Funciona en desktop (Chrome/Edge/Firefox) y mobile (Chrome/Safari iOS+macOS).

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';

interface Props {
  contactId: string;
  agentId: string;
  channel: string;
  onSent: () => void;
  disabled?: boolean;
}

// MediaRecorder mime preference. iOS Safari soporta audio/mp4. Chrome/Firefox webm/opus.
function pickMimeType(): { mime: string; ext: string } {
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: 'audio/mp4', ext: 'm4a' },
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: '', ext: 'webm' }; // fallback - el browser elige
}

function fmtTime(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export default function RecordVoiceButton({ contactId, agentId, channel, onSent, disabled }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'review' | 'uploading'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [permError, setPermError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const mimeRef = useRef<{ mime: string; ext: string }>({ mime: '', ext: 'webm' });

  useEffect(() => {
    return () => {
      // cleanup al desmontar
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setPermError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setPermError('Tu navegador no soporta grabación. Usá Chrome o Safari.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      mimeRef.current = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeRef.current.mime ? { mimeType: mimeRef.current.mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current.mime || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setState('review');
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      recorder.start(100); // chunk cada 100ms
      setState('recording');
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
    } catch (e) {
      const err = e as DOMException;
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermError('Permiso de micrófono denegado. Habilítalo en la barra del navegador.');
      } else {
        setPermError('No se pudo acceder al micrófono: ' + err.message);
      }
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current?.stop();
  };

  const cancelRecording = () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setCaption('');
    setSeconds(0);
    setState('idle');
  };

  const sendRecording = async () => {
    if (!audioBlob) return;
    setState('uploading');
    try {
      const filename = `voice_${Date.now()}.${mimeRef.current.ext}`;
      const file = new File([audioBlob], filename, { type: audioBlob.type || `audio/${mimeRef.current.ext}` });
      const path = `${contactId}/voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${mimeRef.current.ext}`;
      const { error: upErr } = await supabase.storage.from('chat-media').upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upErr) throw upErr;
      // Signed URL temporal (1h) para que Meta pueda descargar el archivo y mandárselo al cliente.
      const { data: signed } = await supabase.storage.from('chat-media').createSignedUrl(path, 3600);
      const deliveryUrl = signed?.signedUrl;
      if (!deliveryUrl) throw new Error('No se pudo generar URL de entrega');

      const { data, error } = await supabase.functions.invoke('send-message', {
        body: {
          contact_id: contactId,
          content: caption.trim() || '[audio]',
          agent_id: agentId,
          media_type: 'audio',
          media_url: deliveryUrl,
          media_path: path,
          media_caption: caption.trim() || undefined,
          media_mime: file.type,
          media_filename: filename,
          media_size_bytes: file.size,
        },
      });
      if (error) throw error;

      onSent();
      if (data?.delivery && !data.delivery.ok) {
        const detail = data.delivery.error ?? '';
        alert(`Audio guardado en el chat, pero el envío al canal falló:\n\n${detail.slice(0, 300)}`);
      }
      cancelRecording();
    } catch (e) {
      alert('Error al enviar audio: ' + (e as Error).message);
      setState('review');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => state === 'idle' ? startRecording() : state === 'recording' ? stopRecording() : null}
        disabled={disabled || state === 'uploading'}
        title={state === 'recording' ? `Grabando · ${fmtTime(seconds)} · tocá para parar` : 'Grabar audio'}
        className={`px-3 py-3 rounded-xl text-sm transition-colors flex-shrink-0 border ${
          state === 'recording'
            ? 'bg-red-500 border-red-500 text-white animate-pulse'
            : 'bg-bg-input border-border text-muted hover:border-crimson hover:text-crimson disabled:opacity-40'
        }`}
      >
        {state === 'recording' ? `🔴 ${fmtTime(seconds)}` : '🎤'}
      </button>

      {permError && (
        <div className="absolute bottom-full mb-2 right-0 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg max-w-xs z-50">
          {permError}
          <button onClick={() => setPermError(null)} className="ml-2 underline">cerrar</button>
        </div>
      )}

      {state === 'review' && audioUrl && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={cancelRecording}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="text-base font-semibold text-[#0F172A]">🎤 Nota de voz · {fmtTime(seconds)}</div>
              <button onClick={cancelRecording} className="text-muted hover:text-[#0F172A]">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <audio src={audioUrl} controls className="w-full" autoPlay={false} />
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Caption opcional (texto que acompaña al audio)…"
                rows={2}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm text-[#0F172A] resize-none"
              />
              <div className="flex gap-2 justify-between">
                <button onClick={cancelRecording} className="px-3 py-2 bg-white border border-border rounded-lg text-sm text-red-600">
                  🗑 Descartar
                </button>
                <div className="flex gap-2">
                  <button onClick={() => { cancelRecording(); setTimeout(() => void startRecording(), 100); }} className="px-3 py-2 bg-white border border-border rounded-lg text-sm">
                    🔄 Re-grabar
                  </button>
                  <button onClick={sendRecording} className="px-4 py-2 bg-crimson text-white rounded-lg text-sm font-medium">
                    Enviar por {channel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {state === 'uploading' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl px-6 py-5 flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-crimson border-t-transparent rounded-full" />
            <span className="text-sm text-[#0F172A]">Enviando audio…</span>
          </div>
        </div>
      )}

      {state === 'recording' && (
        <button
          type="button"
          onClick={cancelRecording}
          title="Cancelar grabación"
          className="px-2 py-3 rounded-xl text-xs bg-white border border-red-300 text-red-600 hover:bg-red-50 flex-shrink-0"
        >
          ✕
        </button>
      )}
    </>
  );
}
