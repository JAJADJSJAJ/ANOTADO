import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Icono } from './Icono.tsx';

/** Lo que avisan los componentes de la demo con window CustomEvent('anotado:tutorial'). */
export type EventoTutorial = 'telefono-abierto' | 'mensaje-enviado' | 'pedido-armado' | 'pedido-confirmado' | 'cocina-empezado' | 'cocina-listo';

/** Evento que escucha TelefonoFlotante para abrirse solo (si se saltó el paso de abrirlo). */
export const ABRIR_TELEFONO = 'anotado:abrir-telefono';
/** Evento que minimiza el teléfono cuando el paso ya no es suyo (así no tapa el mostrador). */
export const CERRAR_TELEFONO = 'anotado:cerrar-telefono';

type Paso = {
  titulo: string;
  texto: string;
  /** Qué iluminar: un data-tutorial o una función que busca el elemento. */
  objetivo?: string | (() => Element | null);
  /** El paso avanza solo cuando llega este evento. */
  evento?: EventoTutorial;
  /** El paso avanza solo cuando se toca el objetivo. */
  alClic?: boolean;
  /** Pantalla donde vive el paso: al entrar al paso, si no estás ahí, te lleva. */
  pantalla?: 'mostrador' | 'cocina';
};

/** El primer botón visible cuyo texto arranca con alguna de estas palabras. */
const botonConTexto = (...textos: string[]) => () =>
  [...document.querySelectorAll('button')].find(
    (b) => visible(b) && textos.some((t) => b.textContent?.trim().startsWith(t)),
  ) ?? null;

const PASOS: Paso[] = [
  {
    titulo: 'Este es tu local',
    texto: 'Arriba están Pedidos (el mostrador) y Cocina. Vamos a seguir un pedido de punta a punta.',
    objetivo: 'barra',
  },
  {
    titulo: 'Sos el cliente',
    texto: 'Abrí el teléfono: le vas a escribir al local como por WhatsApp.',
    objetivo: 'telefono',
    alClic: true,
    evento: 'telefono-abierto',
    pantalla: 'mostrador',
  },
  {
    titulo: 'Pedí como pide la gente',
    texto: 'Escribí tu pedido con tus palabras ("dos muzza y una coca") o tocá un ejemplo, y mandalo.',
    objetivo: 'telefono-panel',
    evento: 'mensaje-enviado',
    pantalla: 'mostrador',
  },
  {
    titulo: 'La IA lo está anotando',
    texto: 'En unos segundos el bot te contesta y el pedido queda armado. Si te pregunta algo, contestale desde el teléfono.',
    objetivo: 'telefono-panel',
    evento: 'pedido-armado',
    pantalla: 'mostrador',
  },
  {
    titulo: 'Llegó al mostrador',
    texto: 'Acá está tu pedido: productos, cantidades y precio, armados por la IA. Si algo está mal, lo corregís acá mismo.',
    objetivo: 'tarjeta',
    pantalla: 'mostrador',
  },
  {
    titulo: 'Elegí la entrega y confirmá',
    texto: 'Marcá si lo retira, va con delivery o es para una mesa, y tocá Confirmar pedido.',
    objetivo: 'panel',
    evento: 'pedido-confirmado',
    pantalla: 'mostrador',
  },
  {
    titulo: 'Vamos a la cocina',
    texto: 'Tocá Cocina para ver cómo le llega el pedido.',
    objetivo: 'cocina',
    alClic: true,
  },
  {
    titulo: 'Cociná',
    texto: 'Tocá Empezar y después Listo: al cliente le llega el aviso por WhatsApp.',
    // Después de Listo ya no queda botón: se ilumina la fila de listos para entregar.
    objetivo: () => botonConTexto('Empezar', 'Listo')() ?? buscar('cocina-lista'),
    evento: 'cocina-listo',
    pantalla: 'cocina',
  },
  {
    titulo: 'También a mano',
    texto: 'Si te piden por teléfono o en el mostrador, lo cargás acá en segundos.',
    objetivo: 'nuevo-pedido',
    pantalla: 'mostrador',
  },
  {
    titulo: 'Y sin WhatsApp conectado',
    texto: 'Pegá los mensajes que te mandó un cliente y la IA arma el pedido igual. Eso es Anotado.',
    objetivo: 'pegar',
    pantalla: 'mostrador',
  },
];

/** Cuánto se muestra el "¡Bien!" antes de pasar solo al paso siguiente. */
const PAUSA_HECHO = 900;
const esDelTelefono = (p: Paso) => typeof p.objetivo === 'string' && p.objetivo.startsWith('telefono');

const MARGEN = 8;

function visible(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return !el.closest('[hidden],[inert],[aria-hidden="true"]');
}

function buscar(objetivo: Paso['objetivo']): Element | null {
  if (!objetivo) return null;
  if (typeof objetivo === 'function') return objetivo();
  const todos = document.querySelectorAll(`[data-tutorial="${objetivo}"]`);
  const el = [...todos].find(visible) ?? null;
  // Un texto marcado adentro de un botón (las pestañas): se ilumina el botón entero.
  return el?.closest('button, a') ?? el;
}

type Caja = { x: number; y: number; w: number; h: number };

const igual = (a: Caja | null, b: Caja | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

const FOCUSABLES = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Lo que se puede enfocar adentro de `el` (incluido él mismo), visible y no inerte. */
function enfocables(el: Element | null): HTMLElement[] {
  if (!el) return [];
  const todos = el.matches(FOCUSABLES) ? [el, ...el.querySelectorAll(FOCUSABLES)] : [...el.querySelectorAll(FOCUSABLES)];
  return todos.filter((e): e is HTMLElement => e instanceof HTMLElement && visible(e));
}

const menosMovimiento = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Tutorial de foco tipo videojuego: oscurece todo, bloquea los clics y deja visible y tocable
 * solo lo del paso actual, con un globito al lado. Algunos pasos avanzan solos cuando hacés la
 * acción. Se monta en el layout del negocio, así sobrevive al pasar del mostrador a la cocina.
 */
export function Tutorial({ slug, onSalir }: { slug: string; onSalir: () => void }) {
  const [i, setI] = useState(0);
  // La acción del paso ya se hizo: se muestra el "¡Bien!" un momento antes de seguir.
  const [hecho, setHecho] = useState(false);
  const paso = PASOS[i]!;
  const [caja, setCaja] = useState<Caja | null>(null);
  const globo = useRef<HTMLDivElement>(null);
  const [tamGlobo, setTamGlobo] = useState({ w: 320, h: 180 });
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const reducido = menosMovimiento();
  // Eventos de la demo que ya pasaron (aunque haya sido antes de llegar al paso que los espera).
  const vistos = useRef(new Set<string>());
  // Si al paso se llegó yendo para adelante: volviendo con Anterior no se salta solo.
  const adelante = useRef(true);

  useEffect(() => {
    const anotar = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      if (typeof d === 'string') vistos.current.add(d);
    };
    window.addEventListener('anotado:tutorial', anotar);
    return () => window.removeEventListener('anotado:tutorial', anotar);
  }, []);

  const ir = useCallback(
    (n: number) => {
      if (n >= PASOS.length) return onSalir();
      setHecho(false);
      setI((actual) => {
        adelante.current = n > actual;
        return Math.max(0, n);
      });
    },
    [onSalir],
  );

  // Al entrar a un paso que vive en otra pantalla, ir para allá.
  useEffect(() => {
    const actual = PASOS[i]!;
    const p = actual.pantalla;
    if (p && !pathname.endsWith(`/${p}`)) navigate(`/${slug}/${p}`);
    // El teléfono se abre solo en sus pasos (si se saltó el de abrirlo) y se minimiza en los demás.
    if (esDelTelefono(actual) && actual.objetivo !== 'telefono') window.dispatchEvent(new CustomEvent(ABRIR_TELEFONO));
    else if (!esDelTelefono(actual)) window.dispatchEvent(new CustomEvent(CERRAR_TELEFONO));
    // Solo al cambiar de paso, no en cada navegación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Medir el objetivo: sondeo liviano (el DOM cambia solo: llegan mensajes, se abren paneles),
  // más ResizeObserver, scroll y resize para que el recorte siga al elemento sin saltos.
  useEffect(() => {
    let el: Element | null = null;
    let primera = true;
    const obs = new ResizeObserver(() => medir());
    function medir() {
      const nuevo = buscar(paso.objetivo);
      if (nuevo !== el) {
        if (el) obs.unobserve(el);
        el = nuevo;
        if (el) {
          obs.observe(el);
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducido || primera ? 'auto' : 'smooth' });
        }
      }
      primera = false;
      const r = el?.getBoundingClientRect();
      const c = r ? { x: r.left - MARGEN, y: r.top - MARGEN, w: r.width + MARGEN * 2, h: r.height + MARGEN * 2 } : null;
      setCaja((ant) => (igual(ant, c) ? ant : c));
    }
    medir();
    const intervalo = window.setInterval(medir, 250);
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    // Al cambiar de pantalla, el wrapper .pantalla-3d entra girado: se vuelve a medir cuando termina.
    const alTerminar = (e: AnimationEvent) => {
      if (e.target instanceof Element && e.target.classList.contains('pantalla-3d')) medir();
    };
    document.addEventListener('animationend', alTerminar);
    return () => {
      document.removeEventListener('animationend', alTerminar);
      window.clearInterval(intervalo);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
      obs.disconnect();
    };
  }, [paso, reducido]);

  // Pasos que esperan una acción: por evento de la demo o por clic en el objetivo.
  useEffect(() => {
    const siguiente = () => {
      setHecho(true);
      return window.setTimeout(() => ir(i + 1), PAUSA_HECHO);
    };
    let espera: number | undefined;
    const alEvento = (e: Event) => {
      if (paso.evento && (e as CustomEvent<string>).detail === paso.evento && espera === undefined) espera = siguiente();
    };
    const alClic = (e: MouseEvent) => {
      if (!paso.alClic || espera !== undefined) return;
      const obj = buscar(paso.objetivo);
      if (obj && e.target instanceof Node && obj.contains(e.target)) espera = siguiente();
    };
    window.addEventListener('anotado:tutorial', alEvento);
    document.addEventListener('click', alClic, true);
    // Lo que el paso espera ya pasó antes de entrar: avanzar igual.
    if (adelante.current && paso.evento) {
      const yaAbierto =
        paso.evento === 'telefono-abierto' && document.querySelector('[data-tutorial="telefono"][data-abierto="true"]') !== null;
      const yaArmado = paso.evento === 'pedido-armado' && document.documentElement.dataset.pedidoArmado === 'true';
      if (yaAbierto || yaArmado || vistos.current.has(paso.evento)) espera = siguiente();
    }
    return () => {
      window.removeEventListener('anotado:tutorial', alEvento);
      document.removeEventListener('click', alClic, true);
      if (espera !== undefined) window.clearTimeout(espera);
    };
  }, [paso, i, ir]);

  // Escape sale; Tab queda atrapado entre el globo y el objetivo del paso (lo único tocable).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onSalir();
      if (e.key !== 'Tab') return;
      const lista = [...enfocables(globo.current), ...enfocables(buscar(paso.objetivo))];
      if (lista.length === 0) return;
      e.preventDefault();
      const actual = lista.indexOf(document.activeElement as HTMLElement);
      const n = actual === -1 ? 0 : (actual + (e.shiftKey ? -1 : 1) + lista.length) % lista.length;
      lista[n]!.focus();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onSalir, paso]);

  // Foco en el globo en cada paso, salvo cuando hay que escribir: ahí va al campo, con unos
  // reintentos cortos porque el teléfono todavía puede estar entrando con su animación.
  useEffect(() => {
    const g = globo.current;
    if (!g) return;
    setTamGlobo((t) => (t.w === g.offsetWidth && t.h === g.offsetHeight ? t : { w: g.offsetWidth, h: g.offsetHeight }));
    if (PASOS[i]!.objetivo !== 'telefono-panel') {
      g.focus({ preventScroll: true });
      return;
    }
    let intentos = 0;
    let t: number | undefined;
    const enfocar = () => {
      const campo = buscar('telefono-input');
      if (campo instanceof HTMLElement) campo.focus({ preventScroll: true });
      if (campo && document.activeElement === campo) return;
      if (++intentos < 8) t = window.setTimeout(enfocar, 100);
      else g.focus({ preventScroll: true });
    };
    enfocar();
    return () => window.clearTimeout(t);
  }, [i]);
  useLayoutEffect(() => {
    const g = globo.current;
    if (!g) return;
    const obs = new ResizeObserver(() => setTamGlobo({ w: g.offsetWidth, h: g.offsetHeight }));
    obs.observe(g);
    return () => obs.disconnect();
  }, []);

  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  // Sin objetivo visible: el recorte se cierra en el centro y el globo queda centrado.
  const c = caja ?? { x: vw / 2, y: vh / 2, w: 0, h: 0 };
  const pos = ubicarGlobo(caja, tamGlobo, vw, vh);
  const transicion = reducido ? 'none' : 'left 420ms var(--ease-salida), top 420ms var(--ease-salida), width 420ms var(--ease-salida), height 420ms var(--ease-salida)';
  const esperando = !!(paso.evento || paso.alClic);

  // Cuatro bloques transparentes alrededor del recorte: frenan los clics fuera del objetivo.
  const bloques = [
    { left: 0, top: 0, width: '100%', height: Math.max(0, c.y) },
    { left: 0, top: c.y + c.h, width: '100%', bottom: 0 },
    { left: 0, top: c.y, width: Math.max(0, c.x), height: c.h },
    { left: c.x + c.w, top: c.y, right: 0, height: c.h },
  ];

  return (
    <div data-tutorial-activo className="fixed inset-0 z-[60]" style={{ pointerEvents: 'none' }}>
      {bloques.map((b, n) => (
        <div key={n} className="absolute" style={{ ...b, pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()} />
      ))}
      <div
        aria-hidden
        className="absolute rounded-xl"
        style={{
          left: c.x,
          top: c.y,
          width: c.w,
          height: c.h,
          transition: transicion,
          // Fondo oscuro parejo y un borde fino; sin halos ni brillos.
          boxShadow: `0 0 0 9999px rgb(0 0 0 / 0.62)${caja ? ', 0 0 0 1.5px rgb(255 255 255 / 0.9)' : ''}`,
        }}
      />

      <div
        ref={globo}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-titulo"
        aria-describedby="tutorial-texto"
        tabIndex={-1}
        className="absolute w-[min(20rem,calc(100vw-2rem))] rounded-2xl bg-hoja p-4 text-tinta shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)] outline-none"
        style={{
          left: pos.x,
          top: pos.y,
          pointerEvents: 'auto',
          transition: reducido ? 'none' : 'left 420ms var(--ease-salida), top 420ms var(--ease-salida)',
        }}
      >
        {pos.flecha && (
          <span
            aria-hidden
            className={`absolute size-3 rotate-45 border-linea bg-hoja ${pos.flecha.arriba ? '-top-1.5 border-t border-l' : '-bottom-1.5 border-r border-b'}`}
            style={{ left: pos.flecha.x - 6 }}
          />
        )}
        <div key={i} className="animate-entra">
          <div className="flex items-center gap-3">
            <p className="rotulo shrink-0 text-tinta-3">
              <span className="num">{i + 1}</span>/<span className="num">{PASOS.length}</span>
            </p>
            <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-linea">
              <span
                className="block h-full rounded-full bg-tinta transition-[width] duration-500 ease-salida"
                style={{ width: `${((i + (hecho ? 1 : 0)) / PASOS.length) * 100}%` }}
              />
            </span>
          </div>
          <h2 id="tutorial-titulo" className="mt-1 text-lg leading-tight font-bold tracking-[-0.015em]">
            {paso.titulo}
          </h2>
          <p id="tutorial-texto" className="mt-1.5 text-[0.9375rem] leading-snug text-tinta-2">
            {paso.texto}
          </p>
          {esperando &&
            (hecho ? (
              <p role="status" className="mt-2 flex animate-entra items-center gap-2 text-sm font-semibold text-ok">
                <Icono nombre="check" className="size-4" />
                ¡Bien! Seguimos.
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-2 text-sm text-tinta-3">
                <span aria-hidden className="size-1.5 shrink-0 animate-latido rounded-full bg-tinta-3" />
                {paso.evento === 'pedido-armado' ? 'Esperando a la IA…' : 'Avanza solo cuando lo hagas.'}
              </p>
            ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={onSalir} className="btn btn-fantasma btn-chico">
            Salir
          </button>
          <div className="ml-auto flex gap-2">
            {i > 0 && (
              <button type="button" onClick={() => ir(i - 1)} className="btn btn-chico" aria-label="Paso anterior">
                <Icono nombre="volver" />
                <span className="max-sm:sr-only">Anterior</span>
              </button>
            )}
            <button type="button" onClick={() => ir(i + 1)} className={`btn btn-chico ${esperando ? '' : 'btn-tinta'}`}>
              {i === PASOS.length - 1 ? 'Terminar' : esperando ? 'Saltar' : 'Siguiente'}
              {i < PASOS.length - 1 && <Icono nombre="flecha" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Dónde va el globo: abajo, arriba, a la derecha o a la izquierda del objetivo, lo primero que
 * entre sin taparlo; si no entra en ningún lado, en la esquina que menos lo pisa. Sin objetivo, al centro.
 */
function ubicarGlobo(caja: Caja | null, g: { w: number; h: number }, vw: number, vh: number) {
  const borde = 16;
  const sep = 14;
  const limX = (x: number) => Math.min(Math.max(borde, x), Math.max(borde, vw - g.w - borde));
  const limY = (y: number) => Math.min(Math.max(borde, y), Math.max(borde, vh - g.h - borde));
  if (!caja) return { x: limX((vw - g.w) / 2), y: limY((vh - g.h) / 2), flecha: null };
  const centro = caja.x + caja.w / 2;
  const x = limX(centro - g.w / 2);
  const flechaX = Math.min(Math.max(18, centro - x), g.w - 18);
  if (caja.y + caja.h + sep + g.h <= vh - borde) return { x, y: caja.y + caja.h + sep, flecha: { arriba: true, x: flechaX } };
  if (caja.y - sep - g.h >= borde) return { x, y: caja.y - sep - g.h, flecha: { arriba: false, x: flechaX } };
  const yMedio = limY(caja.y + caja.h / 2 - g.h / 2);
  if (caja.x + caja.w + sep + g.w <= vw - borde) return { x: caja.x + caja.w + sep, y: yMedio, flecha: null };
  if (caja.x - sep - g.w >= borde) return { x: caja.x - sep - g.w, y: yMedio, flecha: null };
  const esquinas = [
    { x: borde, y: borde },
    { x: vw - g.w - borde, y: borde },
    { x: borde, y: vh - g.h - borde },
    { x: vw - g.w - borde, y: vh - g.h - borde },
  ];
  const pisa = (e: { x: number; y: number }) =>
    Math.max(0, Math.min(e.x + g.w, caja.x + caja.w) - Math.max(e.x, caja.x)) *
    Math.max(0, Math.min(e.y + g.h, caja.y + caja.h) - Math.max(e.y, caja.y));
  const mejor = esquinas.reduce((a, b) => (pisa(b) < pisa(a) ? b : a));
  return { x: mejor.x, y: mejor.y, flecha: null };
}
