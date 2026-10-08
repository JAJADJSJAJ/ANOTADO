import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { BotonPrincipal, Campo, PantallaCuenta, Separador, TituloCuenta } from '../components/Cuenta.tsx';
import { MensajeError, Nota } from '../components/Estado.tsx';
import { efecto } from '../lib/sonido.ts';
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
      efecto('error');
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
      <TituloCuenta titulo="Entrar">Con la cuenta de tu local.</TituloCuenta>
      <form onSubmit={entrar} className="flex flex-col gap-4">
        <Campo
          etiqueta="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <Campo
            etiqueta="Contraseña"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" onClick={() => void olvide()} className="self-end text-sm text-tinta-2 transition-colors hover:text-tinta">
            Me olvidé la contraseña
          </button>
        </div>
        {error && <MensajeError>{error}</MensajeError>}
        {aviso && (
          <Nota tono="ok" rol="status">
            {aviso}
          </Nota>
        )}
        <BotonPrincipal disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</BotonPrincipal>
      </form>
      <Separador>o</Separador>
      <div className="flex flex-col gap-2">
        <Link to="/demo" className="btn btn-grande w-full">
          Probar la demo sin cuenta
        </Link>
        <p className="mt-2 text-center text-sm text-tinta-2">
          ¿Tenés un código para dar de alta tu local?{' '}
          <Link to="/registro" className="enlace">
            Registrate
          </Link>
        </p>
      </div>
    </PantallaCuenta>
  );
}
