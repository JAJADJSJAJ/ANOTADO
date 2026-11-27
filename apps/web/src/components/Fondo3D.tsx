import { useEffect, useRef } from 'react';

/**
 * Piso cuadriculado en perspectiva detrás de las pantallas del local. Se inclina apenas
 * siguiendo el mouse (con lerp). Solo CSS + dos variables: no carga Three.js.
 */
export function Fondo3D() {
  const ref = useRef<HTMLDivElement>(null);

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
      x += (objX - x) * 0.06;
      y += (objY - y) * 0.06;
      el.style.setProperty('--fx', x.toFixed(3));
      el.style.setProperty('--fy', y.toFixed(3));
      raf = Math.abs(objX - x) > 0.002 || Math.abs(objY - y) > 0.002 ? requestAnimationFrame(paso) : 0;
    };
    const mover = (e: PointerEvent) => {
      objX = (e.clientX / window.innerWidth - 0.5) * 2;
      objY = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(paso);
    };
    window.addEventListener('pointermove', mover, { passive: true });
    return () => {
      window.removeEventListener('pointermove', mover);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className="fondo-3d">
      <div className="fondo-3d-piso" />
    </div>
  );
}
