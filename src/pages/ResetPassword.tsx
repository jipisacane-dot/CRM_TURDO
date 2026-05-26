import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

// Página de destino cuando el usuario clickea el link del email de recuperación.
// Supabase pone la sesión "recovery" en la URL hash y la consume al cargar.
// Si la sesión es válida, mostramos form para nueva contraseña.

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase JS detecta automáticamente la sesión del hash y dispara
    // PASSWORD_RECOVERY event. La sesión queda activa solo para updateUser.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });
    // También chequear si ya hay sesión recovery activa (caso de refresh)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Mínimo 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(updErr.message);
      } else {
        setDone(true);
        // Sign out de la recovery session para forzar login normal con la nueva
        await supabase.auth.signOut();
        setTimeout(() => navigate('/login'), 2500);
      }
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
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
          <div className="text-center mb-6">
            <div className="text-2xl font-bold text-white" style={{ fontFamily: 'Georgia, serif' }}>
              Turdo <span className="font-light tracking-[0.3em] text-xl">GROUP</span>
            </div>
          </div>

          {!ready && !done && (
            <div className="text-center text-muted text-sm py-8">
              Verificando link de recuperación...
            </div>
          )}

          {done && (
            <div className="text-center space-y-3 py-4">
              <div className="text-4xl">✅</div>
              <div className="text-[#0F172A] font-semibold">Contraseña actualizada</div>
              <div className="text-xs text-muted">Te llevamos al login...</div>
            </div>
          )}

          {ready && !done && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold text-[#0F172A]">Crear contraseña nueva</h2>
              <div>
                <label className="block text-sm text-muted mb-1.5">Nueva contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-xl px-4 py-3 text-[#0F172A] text-base outline-none focus:border-crimson"
                  autoFocus
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1.5">Repetir contraseña</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-xl px-4 py-3 text-[#0F172A] text-base outline-none focus:border-crimson"
                  autoComplete="new-password"
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
                className="w-full bg-crimson hover:bg-crimson-light text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50"
              >
                {loading ? 'Guardando...' : 'Actualizar contraseña'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
