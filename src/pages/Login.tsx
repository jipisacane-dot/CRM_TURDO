import { useState } from 'react';
import { AGENTS } from '../data/mock';

const TurdoLogoFull = () => (
  <div className="flex flex-col items-center gap-4 mb-10">
    <svg width="90" height="90" viewBox="0 0 100 100" fill="none">
      <path d="M8 8 L92 8 L55 55 L8 8Z" fill="#8B1F1F"/>
      <path d="M8 8 L55 55 L8 92 Z" fill="#9A9A9A" opacity="0.7"/>
      <circle cx="65" cy="62" r="10" fill="#8B1F1F"/>
    </svg>
    <div className="text-center">
      <div className="text-white font-bold text-3xl" style={{ fontFamily: 'Georgia, serif' }}>
        Turdo <span className="font-light tracking-[0.3em] text-2xl">GROUP</span>
      </div>
      <div className="text-muted text-xs tracking-[0.25em] uppercase mt-1">Real Estate &amp; Investments</div>
    </div>
  </div>
);

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanPassword = password.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanPassword) { setError('Completá todos los campos'); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const validPasswords = ['turdo2024', 'Turdo2024', '1234'];
    if (validPasswords.includes(cleanPassword)) {
      const agent = AGENTS.find(a => a.email.toLowerCase() === cleanEmail);
      if (!agent) {
        setLoading(false);
        setError('No encontramos un usuario con ese email. Verificá la dirección.');
        return;
      }
      const session = { email: agent.email, agentId: agent.id, exp: Date.now() + 8 * 60 * 60 * 1000 };
      localStorage.setItem('crm_session', JSON.stringify(session));
      // Hard reload para que AppContext lea la sesión fresca
      window.location.href = '/';
    } else {
      setLoading(false);
      setError(`Contraseña incorrecta. Usá "turdo2024" (sin comillas).`);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-bg-main flex items-center justify-center p-4 safe-top safe-bottom">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-crimson/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-crimson/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-bg-card border border-border rounded-3xl p-8 shadow-2xl">
          <TurdoLogoFull />

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-muted mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-xl px-4 py-3 text-[#0F172A] text-base outline-none focus:border-crimson transition-colors"
                placeholder="usuario@turdogroup.com"
                autoFocus
                autoComplete="username email"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                enterKeyHint="next"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1.5">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-xl px-4 py-3 text-[#0F172A] text-base outline-none focus:border-crimson transition-colors"
                placeholder="••••••••"
                autoComplete="current-password"
                enterKeyHint="go"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-red-600 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-crimson hover:bg-crimson-light text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 mt-2"
            >
              {loading ? 'Ingresando...' : 'Ingresar al CRM'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-border text-center text-muted text-xs">
            ¿Olvidaste tu contraseña? Contactá al administrador
          </div>
        </div>

        <div className="text-center mt-4 text-muted text-xs">
          © 2025 Turdo Group · Todos los derechos reservados
        </div>
      </div>
    </div>
  );
}
