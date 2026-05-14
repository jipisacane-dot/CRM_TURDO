// Resuelve la URL de media de un mensaje. El bucket chat-media es privado:
// guardamos solo el path en messages.media_path y generamos signed URL al vuelo.
// Las URLs viejas (messages.media_url con /public/) quedan inválidas — el backfill
// extrajo el path para los 20 mensajes históricos.

import { supabase } from './supabase';

// Cache simple: signed URLs duran 24h, las cacheamos 12h para evitar regenerar
const cache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL_SEC = 86400; // 24h
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export async function resolveMediaUrl(opts: {
  media_path?: string | null;
  media_url?: string | null;
}): Promise<string | null> {
  // Si tenemos path, generamos signed URL desde el bucket privado
  if (opts.media_path) {
    const cached = cache.get(opts.media_path);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const { data, error } = await supabase.storage
      .from('chat-media')
      .createSignedUrl(opts.media_path, SIGNED_URL_TTL_SEC);

    if (error || !data?.signedUrl) {
      console.warn('createSignedUrl failed for', opts.media_path, error);
      return null;
    }
    cache.set(opts.media_path, { url: data.signedUrl, expiresAt: Date.now() + CACHE_TTL_MS });
    return data.signedUrl;
  }

  // Fallback: media_url legacy (URLs públicas viejas — ahora rotas porque bucket es privado)
  // Solo útil si en algún momento alguien guardó una URL no-chat-media.
  return opts.media_url ?? null;
}
