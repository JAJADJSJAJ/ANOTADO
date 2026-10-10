import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BotonPrincipal, PantallaCuenta, TituloCuenta } from '../components/Cuenta.tsx';
import { Cargando, MensajeError, Nota } from '../components/Estado.tsx';
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
      if (slug) navigate(`/${slug}/simulador`, { replace: true });
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
    navigate(`/${data.slug}/simulador`, { replace: true });
  }

  if (sesion === undefined || (userId && !cuentaReal)) return <Cargando />;

  return (
    <PantallaCuenta>
      <TituloCuenta titulo="Probá Anotado">
        Sos el cliente y sos el local, todo en una pantalla. Sin registrarte.
      </TituloCuenta>
      <ol className="flex flex-col">
        {PASOS.map(([paso, texto], i) => (
          <li key={paso} className="flex animate-entra gap-4 border-b border-dashed border-linea-fuerte py-3 last:border-b-0" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="num pt-0.5 text-xs font-extrabold text-birome">{paso}</span>
            <span className="text-[0.9375rem] leading-snug">{texto}</span>
          </li>
        ))}
      </ol>
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
          <BotonPrincipal type="button" disabled={entrando} onClick={() => void entrar()} className="btn-birome">
            {entrando ? 'Abriendo la demo…' : 'Abrir la demo'}
          </BotonPrincipal>
          <p className="-mt-2 text-center text-sm text-tinta-3">
            La demo es compartida y se borra cada noche: no escribas datos reales.
          </p>
        </>
      )}
    </PantallaCuenta>
  );
}

const PASOS: [string, string][] = [
  ['01', 'Le escribís al local como por WhatsApp, con faltas y todo.'],
  ['02', 'La IA arma el pedido y el bot te contesta. En el mostrador lo revisás y lo confirmás.'],
  ['03', 'La cocina lo ve llegar al instante, lo prepara y lo marca listo.'],
];
