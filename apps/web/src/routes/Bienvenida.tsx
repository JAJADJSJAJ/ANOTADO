import { MIN_PASSWORD, PasswordSchema, rutaInterna } from '@anotado/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BotonPrincipal, Campo, PantallaCuenta, TituloCuenta } from '../components/Cuenta.tsx';
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
  // Cuentas con código del celular (el operador): Supabase exige ese código para cambiar la
  // contraseña. Se pide acá mismo, antes de guardar.
  const [pideCodigo, setPideCodigo] = useState(false);
  const [codigo, setCodigo] = useState('');
  const userId = sesion?.user.id;

  useEffect(() => {
    if (!userId) return;
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2') setPideCodigo(true);
    });
  }, [userId]);

  if (sesion === undefined) return <Cargando />;

  // Con el error del link se avisa aunque haya otra sesión abierta en este navegador.
  if (!sesion || errorLink) {
    return (
      <PantallaCuenta>
        <MensajeError>
          {errorLink ? 'El link venció o ya se usó.' : 'Este link no es válido.'} Pedí uno nuevo desde donde te
          registraste, o desde "Entrar" si olvidaste tu contraseña.
        </MensajeError>
        <Link to="/login" className="btn btn-grande w-full">
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
    if (pideCodigo) {
      const errCodigo = await verificarCodigo(codigo);
      if (errCodigo) {
        setEnviando(false);
        return setError(errCodigo);
      }
    }
    const { error } = await supabase.auth.updateUser({ password: valida.data });
    setEnviando(false);
    if (error) {
      if (error.code === 'insufficient_aal') {
        setPideCodigo(true);
        return setError('Tu cuenta usa el código de la app del celular: escribilo y volvé a guardar.');
      }
      return setError(
        error.code === 'same_password' ? 'Es la misma contraseña que tenías: elegí otra.' : error.message,
      );
    }
    navigate(siguiente, { replace: true });
  }

  return (
    <PantallaCuenta>
      <form onSubmit={guardar} className="flex flex-col gap-4">
        <TituloCuenta titulo="Elegí tu contraseña">
          Mail confirmado: <strong className="font-semibold break-all text-tinta">{sesion.user.email}</strong>
        </TituloCuenta>
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
        {pideCodigo && (
          <Campo
            etiqueta="Código de la app del celular"
            ayuda="Tu cuenta tiene verificación en dos pasos: escribí los 6 números que te muestra."
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
        )}
        {error && <MensajeError>{error}</MensajeError>}
        <BotonPrincipal disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar y seguir'}</BotonPrincipal>
      </form>
    </PantallaCuenta>
  );
}

/** Verifica el código TOTP de la cuenta (sube la sesión a aal2). Devuelve el error, o null. */
async function verificarCodigo(codigo: string): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return error.message;
  const factor = data.totp.find((f) => f.status === 'verified');
  if (!factor) return 'No encontramos la verificación en dos pasos de tu cuenta.';
  const { error: errVerificar } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo.trim() });
  return errVerificar ? 'Código incorrecto o vencido. Probá con el que aparece ahora en el celular.' : null;
}
