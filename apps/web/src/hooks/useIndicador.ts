import { useLayoutEffect, useRef, useState } from 'react';

export type Caja = { x: number; y: number; ancho: number; alto: number; n: number };

/**
 * Mide el elemento activo (por defecto [aria-current="page"]) dentro de un contenedor
 * position:relative, para que un indicador .indicador-3d se deslice hasta él. `n` sube en cada
 * cambio de activo: sirve de key para que la capa interna repita su giro. `clave` = lo que
 * cambia el activo (la ruta). Vuelve a medir si cambia el tamaño.
 */
export function useIndicador<T extends HTMLElement>(clave: unknown, selector = '[aria-current="page"]') {
  const ref = useRef<T>(null);
  const [caja, setCaja] = useState<Caja | null>(null);
  // La primera medición no anima (aparece en su lugar, no deslizándose desde 0,0).
  const [animar, setAnimar] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const a = el.querySelector<HTMLElement>(selector);
      if (!a || a.offsetWidth === 0) return setCaja(null);
      // Offsets y no getBoundingClientRect: ignoran los transforms (el hover 3D de la pestaña
      // la agranda y la corre). El offsetParent es el contenedor relative.
      const r = { width: a.offsetWidth, height: a.offsetHeight };
      const x = a.offsetLeft;
      const y = a.offsetTop;
      setCaja((v) =>
        v && v.x === x && v.y === y && v.ancho === r.width && v.alto === r.height
          ? v
          : { x, y, ancho: r.width, alto: r.height, n: v && (v.x !== x || v.y !== y) ? v.n + 1 : (v?.n ?? 0) },
      );
    };
    medir();
    const raf = requestAnimationFrame(() => setAnimar(true));
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [clave, selector]);

  return { ref, caja, animar };
}
