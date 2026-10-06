import { MIN_PASSWORD, PasswordSchema, rutaInterna } from '@anotado/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BotonPrincipal, Campo, PantallaCuenta } from '../components/Cuenta.tsx';
import { Cargando, MensajeError } from '../components/Estado.tsx';
import { useSesion } from '../hooks/useSesion.ts';
import { supabase } from '../lib/supabase.ts';

/**
 * Destino del link del mail (cuenta nueva o contraseña olvidada). supabase-js toma la sesión
 * que viene en el link; acá la persona elige su contraseña y sigue a `siguiente` (solo rutas
 * internas: nada de redirigir a otro sitio).
 */
export function Bienvenida() {
  const sesion = useSesion();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const siguiente = rutaInterna(params.get('siguiente'));
  // Si el link venció o ya se usó, Supabase vuelve con el error en el hash.
  const [errorLink] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('error_description'));
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (sesion === undefined) return <Cargando />;

  // Con el error del link se avisa aunque haya otra sesión abierta en este navegador.
  if (!sesion || errorLink) {
    return (
      <PantallaCuenta>
        <MensajeError>
          {errorLink ? 'El link venció o ya se usó.' : 'Este link no es válido.'} Pedí uno nuevo desde donde te
          registraste, o desde "Entrar" si olvidaste tu contraseña.
        </MensajeError>
        <Link to="/login" className="font-bold text-indigo-700 underline">
          Ir a Entrar
        </Link>
      </PantallaCuenta>
    );
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valida = PasswordSchema.safeParse(password);
    if (!valida.success) return setError(valida.error.issues[0]?.message ?? 'Contraseña inválida.');
    if (password !== repetida) return setError('Las dos contraseñas no coinciden.');
    setEnviando(true);
    const { error } = await supabase.auth.updateUser({ password: valida.data });
    setEnviando(false);
    if (error) {
      return setError(
        error.code === 'same_password' ? 'Es la misma contraseña que tenías: elegí otra.' : error.message,
      );
    }
    navigate(siguiente, { replace: true });
  }

  return (
    <PantallaCuenta>
      <form onSubmit={guardar} className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-black">Elegí tu contraseña</h2>
          <p className="text-stone-600">
            Mail confirmado: <strong className="break-all">{sesion.user.email}</strong>
          </p>
        </div>
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          ayuda={`Al menos ${MIN_PASSWORD} caracteres.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Campo
          etiqueta="Repetila"
          type="password"
          autoComplete="new-password"
          required
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
        />
        {error && <MensajeError>{error}</MensajeError>}
        <BotonPrincipal disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar y seguir'}</BotonPrincipal>
      </form>
    </PantallaCuenta>
  );
}
