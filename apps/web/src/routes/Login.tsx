import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { MensajeError } from '../components/Estado.tsx';
import { useSesion } from '../hooks/useSesion.ts';
import { supabase } from '../lib/supabase.ts';

export function Login() {
  const sesion = useSesion();
  const navigate = useNavigate();
  const location = useLocation();
  const desde = (location.state as { desde?: string } | null)?.desde ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (sesion) return <Navigate to={desde} replace />;

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setEnviando(false);
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message);
      return;
    }
    navigate(desde, { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
      <form onSubmit={entrar} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 shadow">
        <div>
          <h1 className="text-3xl font-bold">Anotado</h1>
          <p className="text-neutral-600">Entrá con tu cuenta del local.</p>
        </div>
        <label className="flex flex-col gap-1 font-medium">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border-2 border-neutral-300 px-3 py-3 text-lg"
          />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border-2 border-neutral-300 px-3 py-3 text-lg"
          />
        </label>
        {error && <MensajeError>{error}</MensajeError>}
        <button
          type="submit"
          disabled={enviando}
          className="rounded-xl bg-neutral-900 py-4 text-lg font-bold text-white disabled:opacity-50"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
