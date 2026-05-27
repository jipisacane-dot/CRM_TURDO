// Renderiza texto con URLs clicables. Útil para mensajes de chat donde el
// cliente o el vendedor mandan un link de propiedad y queremos que abra
// directo en una pestaña nueva (Leti pidió: "que ese link se pueda tocar
// y te lleve a la publicación de la propiedad").
//
// Detecta:
//   - http(s)://...
//   - www. ...
//   - dominios obvios sin protocolo (turdopropiedades.com/p/abc) — heurística
//
// El componente NO intenta detectar TODOS los casos posibles de URLs (escape
// hatches raros como IDN, IP, etc). Solo los típicos de mensajes inmobiliarios.

import { Fragment } from 'react';

// Regex para URLs: http(s)://, www., o dominio.tld/path con TLD razonable.
// El '\b' al inicio asegura que no matchee parte de otra palabra.
// Capturamos hasta el primer espacio o newline.
const URL_RE = /(\bhttps?:\/\/[^\s<]+|\bwww\.[^\s<]+|\b[a-z0-9-]+\.(?:com|com\.ar|net|org|io|app|me|co|ar)(?:\/[^\s<]*)?)/gi;

function normalizeHref(raw: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return 'https://' + raw;
}

function trimTrailingPunctuation(url: string): { url: string; trail: string } {
  // Saca caracteres comunes que NO son parte de la URL aunque estén pegados:
  // puntos finales, comas, paréntesis cerrados, dos puntos solitarios, etc.
  let trail = '';
  while (url.length > 0 && /[.,;:!?)\]]/.test(url.slice(-1))) {
    trail = url.slice(-1) + trail;
    url = url.slice(0, -1);
  }
  return { url, trail };
}

interface Props {
  text: string;
  className?: string;
  linkClassName?: string;
}

export default function LinkifiedText({ text, className, linkClassName }: Props) {
  if (!text) return null;

  // Split por URLs preservando los matches con un capture group
  const parts: Array<{ type: 'text' | 'url'; value: string; trail?: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Re-crear regex para cada render por el state interno de lastIndex
  const re = new RegExp(URL_RE.source, URL_RE.flags);
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const { url, trail } = trimTrailingPunctuation(match[0]);
    parts.push({ type: 'url', value: url, trail });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return (
    <p className={className}>
      {parts.map((p, i) => {
        if (p.type === 'text') return <Fragment key={i}>{p.value}</Fragment>;
        return (
          <Fragment key={i}>
            <a
              href={normalizeHref(p.value)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={e => e.stopPropagation()}
              className={linkClassName ?? 'underline underline-offset-2 hover:opacity-80 break-all'}
            >
              {p.value}
            </a>
            {p.trail}
          </Fragment>
        );
      })}
    </p>
  );
}
