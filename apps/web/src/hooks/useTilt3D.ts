import { useEffect, useRef } from 'react';

/**
 * Inclina en 3D un elemento .tilt-3d-cara siguiendo el puntero (con lerp, para que se sienta
 * pesado como papel). Escribe --rx / --ry en el elemento. Se apaga con menos movimiento y en
 * pantallas táctiles (sin hover fino).
 */
export function useTilt3D<T extends HTMLElement>(maxGrados = 4) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof matchMedia !== 'function') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let objX = 0;
    let objY = 0;
    let x = 0;
    let y = 0;
    let raf = 0;

    const paso = () => {
      x += (objX - x) * 0.14;
      y += (objY - y) * 0.14;
      el.style.setProperty('--rx', `${(-y * maxGrados).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(x * maxGrados).toFixed(2)}deg`);
      if (Math.abs(objX - x) > 0.002 || Math.abs(objY - y) > 0.002) raf = requestAnimationFrame(paso);
      else raf = 0;
    };
    const arrancar = () => {
      if (!raf) raf = requestAnimationFrame(paso);
    };
    const mover = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      objX = ((e.clientX - r.left) / r.width - 0.5) * 2;
      objY = ((e.clientY - r.top) / r.height - 0.5) * 2;
      arrancar();
    };
    const salir = () => {
      objX = 0;
      objY = 0;
      arrancar();
    };

    el.addEventListener('pointermove', mover);
    el.addEventListener('pointerleave', salir);
    return () => {
      el.removeEventListener('pointermove', mover);
      el.removeEventListener('pointerleave', salir);
      cancelAnimationFrame(raf);
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
    };
  }, [maxGrados]);

  return ref;
}
