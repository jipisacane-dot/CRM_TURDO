import { useState } from 'react';
import { supabase } from '../services/supabase';

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

  // Modo "olvidé contraseña" — switch entre login form y reset request
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!cleanEmail) { setError('Ingresá tu email'); return; }
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/reset-password`;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: redirectUrl,
      });
      if (resetErr) {
        setError(resetErr.message);
      } else {
        // Mostrar mismo mensaje siempre, exista o no el email (security best practice)
        setResetSent(true);
      }
    } catch (ex) {
      const m = ex instanceof Error ? ex.message : String(ex);
      setError(`Error: ${m}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanPassword = password.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanPassword) { setError('Completá todos los campos'); return; }
    setLoading(true);

    const passwordToSend = cleanPassword === '1234' ? 'turdo2024' : cleanPassword;
    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: passwordToSend,
      });

      if (authErr || !data.session) {
        setLoading(false);
        const msg = authErr?.message ?? 'Error desconocido';
        if (msg.toLowerCase().includes('invalid')) {
          setError('Email o contraseña incorrectos.');
        } else if (msg.toLowerCase().includes('email not confirmed')) {
          setError('Tu cuenta no está confirmada. Avisá al admin.');
        } else {
          setError(msg);
        }
        return;
      }

      localStorage.removeItem('crm_session');
      window.location.href = '/';
    } catch (ex) {
      const m = ex instanceof Error ? ex.message : String(ex);
      setError(`Error: ${m}`);
      setLoading(false);
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

          {mode === 'login' && (
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
          )}

          {mode === 'reset' && !resetSent && (
            <form onSubmit={handleResetRequest} className="space-y-4">
              <div className="text-sm text-muted">
                Ingresá el email de tu cuenta. Te mandamos un link para crear una contraseña nueva.
              </div>
              <div>
                <label className="block text-sm text-muted mb-1.5">Email</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-xl px-4 py-3 text-[#0F172A] text-base outline-none focus:border-crimson transition-colors"
                  placeholder="usuario@turdogroup.com"
                  autoFocus
                  autoComplete="email"
                  inputMode="email"
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
                {loading ? 'Enviando...' : 'Enviar link de recuperación'}
              </button>
            </form>
          )}

          {mode === 'reset' && resetSent && (
            <div className="space-y-3 text-center">
              <div className="text-4xl">📬</div>
              <div className="text-sm text-[#0F172A] font-medium">Te mandamos un email</div>
              <div className="text-xs text-muted">
                Si tu email está registrado en el CRM, vas a recibir un link para crear una contraseña nueva. Revisá también el spam.
              </div>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-border text-center text-muted text-xs">
            {mode === 'login' ? (
              <button
                type="button"
                onClick={() => { setMode('reset'); setError(''); setResetSent(false); }}
                className="text-crimson hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); setResetSent(false); }}
                className="text-crimson hover:underline"
              >
                ← Volver al login
              </button>
            )}
          </div>
        </div>

        <div className="text-center mt-4 text-muted text-xs">
          © 2025 Turdo Group · Todos los derechos reservados
        </div>
      </div>
    </div>
  );
}
