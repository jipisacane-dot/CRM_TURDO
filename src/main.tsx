import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

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
