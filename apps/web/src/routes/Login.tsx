import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { BotonPrincipal, Campo, PantallaCuenta } from '../components/Cuenta.tsx';
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
  const [aviso, setAviso] = useState<string | null>(null);
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

  /** Manda el link para elegir una contraseña nueva (pantalla /bienvenida). */
  async function olvide() {
    setError(null);
    setAviso(null);
    if (!email.trim()) return setError('Escribí tu email y tocá de nuevo "Me olvidé la contraseña".');
    setEnviando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/bienvenida?siguiente=${encodeURIComponent(desde)}`,
    });
    setEnviando(false);
    // Mismo mensaje exista o no la cuenta: no se revela qué mails están registrados.
    if (error) return setError('No se pudo mandar el mail. Probá de nuevo en un rato.');
    setAviso(`Si hay una cuenta con ${email.trim()}, te llegó un mail para elegir una contraseña nueva.`);
  }

  return (
    <PantallaCuenta>
      <form onSubmit={entrar} className="flex flex-col gap-4">
        <p className="font-semibold text-stone-700">Entrá con tu cuenta del local.</p>
        <Campo
          etiqueta="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <MensajeError>{error}</MensajeError>}
        {aviso && (
          <p role="status" className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3 font-medium text-emerald-900">
            {aviso}
          </p>
        )}
        <BotonPrincipal disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</BotonPrincipal>
        <button
          type="button"
          onClick={() => void olvide()}
          className="self-center text-sm font-medium text-stone-600 underline"
        >
          Me olvidé la contraseña
        </button>
      </form>
      <p className="border-t border-stone-200 pt-4 text-center text-stone-600">
        ¿Tenés un código para dar de alta tu local?{' '}
        <Link to="/registro" className="font-bold text-indigo-700 underline">
          Registrate
        </Link>
      </p>
    </PantallaCuenta>
  );
}
