import { type RolMiembro, TokenInvitacionSchema } from '@anotado/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { BotonPrincipal, Campo, MailEnviado, PantallaCuenta } from '../components/Cuenta.tsx';
import { Cargando, MensajeError } from '../components/Estado.tsx';
import { useSesion } from '../hooks/useSesion.ts';
import { NOMBRE_ROL } from '../lib/contextos.ts';
import { pedirCuenta } from '../lib/funciones.ts';
import { supabase } from '../lib/supabase.ts';

type DatosInvitacion = { negocio: string; rol: RolMiembro; ya_es_miembro: boolean };

/**
 * Link que manda el dueño por WhatsApp: /invitacion/<token>. Sin sesión, la persona crea su
 * cuenta (o entra con la que tiene); con sesión, ve a qué local la invitan y acepta.
 */
export function Invitacion() {
  const { token = '' } = useParams();
  const sesion = useSesion();
  const valido = TokenInvitacionSchema.safeParse(token).success;

  if (!valido) {
    return (
      <PantallaCuenta>
        <MensajeError>Este link de invitación no es válido. Pedile uno nuevo al dueño del local.</MensajeError>
      </PantallaCuenta>
    );
  }
  if (sesion === undefined) return <Cargando />;
  return (
    <PantallaCuenta>
      {sesion ? <Aceptar token={token} email={sesion.user.email ?? ''} /> : <CrearCuenta token={token} />}
    </PantallaCuenta>
  );
}

function CrearCuenta({ token }: { token: string }) {
  const [email, setEmail] = useState('');
  const [mailEnviado, setMailEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    // El mail trae un link a /bienvenida, que después vuelve acá con sesión para aceptar.
    const err = await pedirCuenta({ email: email.trim(), invitacion: token });
    setEnviando(false);
    if (err) setError(err);
    else setMailEnviado(true);
  }

  if (mailEnviado) return <MailEnviado email={email.trim()} onOtroMail={() => setMailEnviado(false)} />;

  return (
    <>
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-black">Te invitaron a un local</h2>
          <p className="text-stone-600">Creá tu cuenta para sumarte.</p>
        </div>
        <Campo
          etiqueta="Tu email"
          type="email"
          autoComplete="email"
          required
          ayuda="Te mandamos un link para confirmarlo y elegir tu contraseña."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <MensajeError>{error}</MensajeError>}
        <BotonPrincipal disabled={enviando}>{enviando ? 'Enviando…' : 'Seguir'}</BotonPrincipal>
      </form>
      <p className="border-t border-stone-200 pt-4 text-center text-stone-600">
        ¿Ya tenés cuenta?{' '}
        <Link to="/login" state={{ desde: `/invitacion/${token}` }} className="font-bold text-indigo-700 underline">
          Entrá
        </Link>
      </p>
    </>
  );
}

function Aceptar({ token, email }: { token: string; email: string }) {
  const navigate = useNavigate();
  const [datos, setDatos] = useState<DatosInvitacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void supabase.rpc('ver_invitacion', { p_token: token }).then(({ data, error }) => {
      if (error) setError(error.message);
      else setDatos(data as DatosInvitacion);
    });
  }, [token]);

  async function aceptar() {
    setEnviando(true);
    setError(null);
    const { data, error } = await supabase.rpc('aceptar_invitacion', { p_token: token });
    setEnviando(false);
    if (error) return setError(error.message);
    navigate(`/${(data as { slug: string }).slug}`, { replace: true });
  }

  const cuenta = (
    <p className="text-sm text-stone-500">
      Entraste como {email}. <BotonSalir className="px-0 py-0 text-stone-500" />
    </p>
  );

  if (error) {
    return (
      <>
        <MensajeError>{error}</MensajeError>
        <p className="text-stone-600">Si el link venció, pedile uno nuevo al dueño del local.</p>
        {cuenta}
      </>
    );
  }
  if (!datos) return <Cargando />;
  if (datos.ya_es_miembro) {
    return (
      <>
        <p className="text-lg">
          Ya sos parte de <strong>{datos.negocio}</strong>.
        </p>
        <Link to="/" className="font-bold text-indigo-700 underline">
          Ir a mis locales
        </Link>
        {cuenta}
      </>
    );
  }
  return (
    <>
      <div>
        <h2 className="text-xl font-black">{datos.negocio}</h2>
        <p className="text-lg text-stone-700">
          Te invitaron como <strong>{NOMBRE_ROL[datos.rol]}</strong>.
        </p>
      </div>
      <BotonPrincipal type="button" disabled={enviando} onClick={() => void aceptar()}>
        {enviando ? 'Sumándote…' : 'Aceptar y entrar'}
      </BotonPrincipal>
      {cuenta}
    </>
  );
}
