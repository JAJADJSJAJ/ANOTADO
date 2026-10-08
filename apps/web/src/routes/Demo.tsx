import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PantallaCuenta } from '../components/Cuenta.tsx';
import { Cargando, MensajeError } from '../components/Estado.tsx';
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
      <h2 className="text-2xl font-black">Probá la demo</h2>
      <p className="text-stone-700">
        Escribí como si fueras un cliente por WhatsApp. La IA arma el pedido, el bot te contesta, lo confirmás en el
        mostrador y lo ves llegar a la cocina. Todo en una pantalla.
      </p>
      <p className="text-sm text-stone-500">
        Sin registrarte. La demo es compartida y se borra cada noche: no escribas datos reales.
      </p>
      {cuentaReal ? (
        <>
          <p className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 font-medium text-amber-950">
            Estás con tu cuenta. Para probar la demo, salí primero.
          </p>
          <button
            type="button"
            onClick={() => void supabase.auth.signOut().then(() => setCuentaReal(false))}
            className="rounded-xl bg-stone-900 py-4 text-lg font-bold text-white"
          >
            Salir
          </button>
          <Link to="/" className="self-center text-stone-600 underline">
            Volver a mi local
          </Link>
        </>
      ) : (
        <>
          {error && <MensajeError>{error}</MensajeError>}
          <button
            type="button"
            disabled={entrando}
            onClick={() => void entrar()}
            className="rounded-xl bg-indigo-600 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/20 active:bg-indigo-700 disabled:opacity-50"
          >
            {entrando ? 'Abriendo la demo…' : 'Probar la demo'}
          </button>
        </>
      )}
    </PantallaCuenta>
  );
}
