import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BotonPrincipal, TituloCuenta } from '../components/Cuenta.tsx';
import { Escena3D } from '../components/Escena3D.tsx';
import { Letras3D } from '../components/Letras3D.tsx';
import { Marca } from '../components/Marca.tsx';
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

  const acciones = cuentaReal ? (
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
      <p className="-mt-2 text-center text-sm text-tinta-3">La demo es compartida y se borra cada noche: no escribas datos reales.</p>
    </>
  );

  return (
    <div className="min-h-dvh">
      <section className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
        <Link to="/login" className="self-start">
          <Marca />
        </Link>
        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <h1 className="text-[2.75rem] leading-[1.02] font-bold tracking-[-0.035em] sm:text-6xl">
            <Letras3D texto="Los pedidos de WhatsApp, anotados solos." retardo={150} />
          </h1>
          <div className="flex w-full max-w-sm flex-col gap-6">
            <TituloCuenta titulo="Probá Anotado">
              Mandá un pedido como por WhatsApp y miralo llegar anotado al mostrador y a la cocina. Sin registrarte, en un minuto.
            </TituloCuenta>
            {acciones}
          </div>
        </div>
        <a href="#como-funciona" className="mx-auto flex flex-col items-center gap-1 text-sm text-tinta-3 transition-colors hover:text-tinta">
          Cómo funciona
          <span aria-hidden className="animate-bounce">↓</span>
        </a>
      </section>

      <Historia />

      <section className="mx-auto flex min-h-[70dvh] w-full max-w-sm flex-col justify-center gap-6 px-5 py-16">
        <TituloCuenta titulo="Ahora probalo vos">Escribí tu propio pedido y seguilo hasta la cocina.</TituloCuenta>
        {acciones}
        <Link to="/privacidad" className="self-center text-sm text-tinta-3 transition-colors hover:text-tinta">
          Privacidad
        </Link>
      </section>
    </div>
  );
}

/** Los cuatro momentos de la historia y en qué punto del scroll (0 a 1) empieza cada uno. */
const MOMENTOS = [
  { desde: 0, titulo: 'El cliente escribe', texto: 'Como siempre, por WhatsApp y con sus palabras: “2 completas sin tomate y una coca de 1,5”.' },
  { desde: 0.32, titulo: 'La IA lo anota', texto: 'Lee el mensaje, encuentra los productos del menú con sus precios y, si falta algo, le pregunta.' },
  { desde: 0.47, titulo: 'Sale la comanda', texto: 'El mostrador lo confirma y la cocina lo recibe al instante, como un ticket impreso.' },
  { desde: 0.74, titulo: 'Listo', texto: 'La cocina lo marca listo y al cliente le llega el aviso. Nadie copió nada a mano.' },
];

const nuevoProgreso = () => ({ valor: 0 });
/** La escena lee este objeto en cada cuadro: se escribe por fuera de React, sin re-render. */
function fijar(progreso: { valor: number }, valor: number) {
  progreso.valor = valor;
}

/**
 * La historia del pedido guiada por el scroll: un tramo alto con la escena 3D fija (sticky);
 * al bajar, el celular tipea, el mensaje viaja y la comanda se imprime y se sella.
 */
function Historia() {
  const tramo = useRef<HTMLElement>(null);
  // Objeto estable que lee la escena en cada cuadro (sin re-render por scroll).
  const [progreso] = useState(nuevoProgreso);
  const [momento, setMomento] = useState(0);
  const compacta = typeof window !== 'undefined' && window.innerWidth < 1024;

  useEffect(() => {
    const medir = () => {
      const el = tramo.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - window.innerHeight)));
      // Se reserva el último 15 % para quedarse mirando la comanda sellada.
      fijar(progreso, Math.min(1, p / 0.85));
      const m = MOMENTOS.findLastIndex((x) => progreso.valor >= x.desde);
      setMomento(Math.max(0, m));
    };
    medir();
    window.addEventListener('scroll', medir, { passive: true });
    window.addEventListener('resize', medir);
    return () => {
      window.removeEventListener('scroll', medir);
      window.removeEventListener('resize', medir);
    };
  }, [progreso]);

  return (
    <section id="como-funciona" ref={tramo} aria-label="Cómo funciona" className="relative h-[340vh] bg-tinta text-white">
      <div className="sticky top-0 grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:grid-rows-1">
        <ol className="relative z-10 flex flex-col justify-center gap-5 px-6 pt-10 sm:px-10 lg:gap-8 lg:py-10 lg:pl-14">
          {MOMENTOS.map((m, i) => (
            <li
              key={m.titulo}
              aria-current={i === momento ? 'step' : undefined}
              className={`historia-paso ${i === momento ? 'historia-paso-activo' : i < momento ? 'opacity-35' : 'opacity-20'} ${i === momento ? '' : 'max-lg:hidden'}`}
            >
              <p className="num text-xs tracking-[0.08em] text-white/50">0{i + 1}</p>
              <p className="mt-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">{m.titulo}</p>
              <p className={`mt-2 max-w-sm leading-snug text-white/65 ${i === momento ? '' : 'hidden'}`}>{m.texto}</p>
            </li>
          ))}
        </ol>
        <div className="relative min-h-0">
          <Escena3D progreso={progreso} compacta={compacta} className="absolute inset-0 flex items-end px-6 pb-8 sm:px-10" />
        </div>
      </div>
    </section>
  );
}
