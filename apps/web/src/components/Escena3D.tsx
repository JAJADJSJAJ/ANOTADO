import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { montarEscena as MontarEscena } from './escena3d/motor.ts';

// La escena 3D de la pantalla de entrada. three va en un chunk aparte: se baja recién cuando
// se monta este componente, así no pesa en el resto de la app.

interface Props {
  /** Versión chica (móvil): menos partículas y menos resolución. */
  compacta?: boolean;
  /** Lo que se muestra si no hay WebGL. */
  respaldo?: ReactNode;
  className?: string;
  /** Historia guiada por scroll (ver OpcionesEscena.progreso). Tiene que ser un objeto estable. */
  progreso?: { valor: number };
}

interface PropsLienzo extends Props {
  montar: typeof MontarEscena;
  hayWebGL: () => boolean;
}

function Lienzo({ montar, hayWebGL, compacta = false, respaldo = null, className = '', progreso }: PropsLienzo) {
  const host = useRef<HTMLDivElement>(null);
  // Sin WebGL no hay nada que montar: se decide al primer render.
  const [falla, setFalla] = useState(() => !hayWebGL());
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const estatica = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      return montar(el, { estatica, compacta, progreso, alListo: () => setListo(true) });
    } catch {
      // Se difiere para no actualizar estado de forma sincrónica dentro del efecto.
      queueMicrotask(() => setFalla(true));
    }
  }, [montar, compacta, progreso]);

  if (falla) return <div className={className}>{respaldo}</div>;
  return (
    <div
      ref={host}
      aria-hidden
      className={`transition-opacity duration-700 ease-out ${listo ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  );
}

const LienzoDiferido = lazy(async () => {
  const m = await import('./escena3d/motor.ts');
  return { default: (p: Props) => <Lienzo {...p} montar={m.montarEscena} hayWebGL={m.hayWebGL} /> };
});

/** Celular que manda un pedido de WhatsApp y comanda que se imprime, en loop. */
export function Escena3D(props: Props) {
  return (
    <Suspense fallback={<div aria-hidden className={props.className} />}>
      <LienzoDiferido {...props} />
    </Suspense>
  );
}
