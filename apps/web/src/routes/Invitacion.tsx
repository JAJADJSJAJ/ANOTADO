import { type RolMiembro, TokenInvitacionSchema } from '@anotado/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BotonPrincipal, Campo, MailEnviado, PantallaCuenta, TituloCuenta } from '../components/Cuenta.tsx';
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
        <TituloCuenta titulo="Te invitaron a un local">Creá tu cuenta para sumarte.</TituloCuenta>
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
      <p className="border-t border-linea pt-5 text-center text-sm text-tinta-2">
        ¿Ya tenés cuenta?{' '}
        <Link to="/login" state={{ desde: `/invitacion/${token}` }} className="enlace">
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
    <p className="text-sm text-tinta-3">
      Entraste como {email}.{' '}
      <button type="button" onClick={() => void supabase.auth.signOut()} className="enlace">
        Salir
      </button>
    </p>
  );

  if (error) {
    return (
      <>
        <MensajeError>{error}</MensajeError>
        <p className="text-tinta-2">Si el link venció, pedile uno nuevo al dueño del local.</p>
        {cuenta}
      </>
    );
  }
  if (!datos) return <Cargando />;
  if (datos.ya_es_miembro) {
    return (
      <>
        <TituloCuenta titulo={datos.negocio}>Ya sos parte de este local.</TituloCuenta>
        <Link to="/" className="btn btn-tinta btn-grande w-full">
          Ir a mis locales
        </Link>
        {cuenta}
      </>
    );
  }
  return (
    <>
      <TituloCuenta titulo={datos.negocio}>
        Te invitaron como <strong className="font-semibold text-tinta">{NOMBRE_ROL[datos.rol].toLowerCase()}</strong>.
      </TituloCuenta>
      <BotonPrincipal type="button" disabled={enviando} onClick={() => void aceptar()}>
        {enviando ? 'Sumándote…' : 'Aceptar y entrar'}
      </BotonPrincipal>
      {cuenta}
    </>
  );
}
