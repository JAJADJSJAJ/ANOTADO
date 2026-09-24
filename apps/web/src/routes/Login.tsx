import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { MensajeError } from '../components/Estado.tsx';
import { Logo } from '../components/Marca.tsx';
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-indigo-50 to-stone-100 p-4">
      <div className="text-center">
        <Logo className="mx-auto size-14" />
        <h1 className="mt-3 text-4xl font-black tracking-tight">Anotado</h1>
        <p className="mt-1 text-lg text-stone-600">Los pedidos de WhatsApp, anotados solos.</p>
      </div>
      <form onSubmit={entrar} className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white p-6 shadow-xl shadow-indigo-900/5">
        <p className="font-semibold text-stone-700">Entrá con tu cuenta del local.</p>
        <label className="flex flex-col gap-1 font-medium">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border-2 border-stone-300 px-3 py-3 text-lg outline-none focus:border-indigo-500"
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
            className="rounded-xl border-2 border-stone-300 px-3 py-3 text-lg outline-none focus:border-indigo-500"
          />
        </label>
        {error && <MensajeError>{error}</MensajeError>}
        <button
          type="submit"
          disabled={enviando}
          className="rounded-xl bg-indigo-600 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/20 active:bg-indigo-700 disabled:opacity-50"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
