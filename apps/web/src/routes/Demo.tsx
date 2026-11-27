import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BotonPrincipal, PantallaCuenta, TituloCuenta } from '../components/Cuenta.tsx';
import { EsqueletoPagina } from '../components/Esqueletos.tsx';
import { MensajeError, Nota } from '../components/Estado.tsx';
import { efecto } from '../lib/sonido.ts';
import { useSesion } from '../hooks/useSesion.ts';
import { mensajeDeFuncion } from '../lib/funciones.ts';
import { supabase } from '../lib/supabase.ts';

/** Local de demo del usuario con sesión, si tiene. */
async function slugDeDemo(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('negocios')
    .select('slug, miembros!inner(user_id)')
    .eq('es_demo', true)
    .eq('miembros.user_id', userId)
    .limit(1)
    .maybeSingle();
  return data?.slug ?? null;
}

/**
 * /demo: la puerta pública para probar Anotado sin cuenta. La Edge Function demo-entrar crea una
 * cuenta de demo (dura un día) y devuelve un token de un solo uso que acá se canjea por la sesión.
 */
export function Demo() {
  const sesion = useSesion();
  const navigate = useNavigate();
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cuentaReal, setCuentaReal] = useState(false);
  const userId = sesion?.user.id;

  // Con sesión: si ya es de la demo, directo adentro; si es una cuenta real, se avisa.
  useEffect(() => {
    if (!userId) return;
    let vigente = true;
    void slugDeDemo(userId).then((slug) => {
      if (!vigente) return;
      if (slug) navigate(`/${slug}/mostrador`, { replace: true });
      else setCuentaReal(true);
    });
    return () => {
      vigente = false;
    };
  }, [userId, navigate]);

  async function entrar() {
    setEntrando(true);
    setError(null);
    const { data, error: errFuncion } = await supabase.functions.invoke<{ token_hash: string; slug: string }>('demo-entrar', {
      body: {},
    });
    if (errFuncion || !data) {
      setEntrando(false);
      efecto('error');
      return setError(await mensajeDeFuncion(errFuncion, 'No se pudo abrir la demo. Probá de nuevo.'));
    }
    const { error: errOtp } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
    if (errOtp) {
      setEntrando(false);
      return setError('No se pudo abrir la demo. Probá de nuevo.');
    }
    // Carga completa, no navigate: recién iniciada la sesión, Realtime todavía no tiene el
    // token nuevo y la cocina quedaba suscripta sin recibir avisos (los pedidos llegaban con
    // la recarga de cada 30 s). Medido en producción: con la página recién cargada, al instante.
    // ?tutorial=1: el local abre ofreciendo el tutorial.
    window.location.replace(`/${data.slug}/mostrador?tutorial=1`);
  }

  if (sesion === undefined || (userId && !cuentaReal)) return <EsqueletoPagina />;

  return (
    <PantallaCuenta escenaMovil>
      <TituloCuenta titulo="Probá Anotado">
        Mandá un pedido como por WhatsApp y miralo llegar anotado al mostrador y a la cocina. Sin registrarte, en un minuto.
      </TituloCuenta>
      {cuentaReal ? (
        <>
          <Nota tono="alerta">Estás con tu cuenta. Para probar la demo, salí primero.</Nota>
          <BotonPrincipal type="button" onClick={() => void supabase.auth.signOut().then(() => setCuentaReal(false))}>
            Salir de mi cuenta
          </BotonPrincipal>
          <Link to="/" className="enlace self-center text-sm">
            Volver a mi local
          </Link>
        </>
      ) : (
        <>
          {error && <MensajeError>{error}</MensajeError>}
          <BotonPrincipal type="button" disabled={entrando} onClick={() => void entrar()} className="btn-birome group">
            {entrando ? (
              'Abriendo la demo…'
            ) : (
              <>
                Abrir la demo
                <span aria-hidden className="inline-block transition-transform duration-200 ease-out group-hover:translate-x-1 group-active:translate-x-0.5">
                  →
                </span>
              </>
            )}
          </BotonPrincipal>
          <p className="-mt-2 text-center text-sm text-tinta-3">
            La demo es compartida y se borra cada noche: no escribas datos reales.
          </p>
        </>
      )}
    </PantallaCuenta>
  );
}
