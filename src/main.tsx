import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Auto-reload cuando un chunk lazy-loaded ya no existe (deploy nuevo invalidó hash).
// Pasa cuando el usuario tiene la pestaña abierta y se hace un deploy: el chunk
// que pide React no existe en Vercel. Hard reload baja el index.html nuevo con
// los hashes actuales. Sólo recargamos una vez para evitar loops.
const CHUNK_RELOAD_KEY = 'chunk-reload-attempted';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    window.location.reload();
  }
});
// Reset del flag cuando la app carga OK
window.addEventListener('load', () => sessionStorage.removeItem(CHUNK_RELOAD_KEY));

// ── Registrar Service Worker para push notifications ────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('SW registrado:', reg.scope);
      })
      .catch((err) => {
        console.error('SW registration failed:', err);
      });

    // Cuando el SW manda postMessage NAVIGATE (al hacer click en notif), navegar
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'NAVIGATE' && event.data?.url) {
        window.location.href = event.data.url;
      }
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
