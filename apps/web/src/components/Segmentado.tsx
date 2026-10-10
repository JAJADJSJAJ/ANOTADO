import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

export type Opcion<T extends string> = { valor: T; texto: ReactNode; etiqueta?: string };

/**
 * Pestañas o selector de opciones con un indicador blanco que se desliza a la elegida.
 * `pestanas` = rol tablist (cambia de pantalla); si no, botones con aria-pressed (elige un valor).
 */
export function Segmentado<T extends string>({
  opciones,
  valor,
  onCambio,
  pestanas = false,
  etiqueta,
  className = '',
}: {
  opciones: Opcion<T>[];
  valor: T | null;
  onCambio: (v: T) => void;
  pestanas?: boolean;
  etiqueta?: string;
  className?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [indicador, setIndicador] = useState<{ x: number; ancho: number } | null>(null);
  // La primera vez el indicador aparece en su lugar, sin deslizarse desde la izquierda.
  const [animar, setAnimar] = useState(false);

  // Mide el botón elegido; vuelve a medir si cambia el tamaño (fuentes, ventana, contadores).
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => {
      const b = el.querySelector<HTMLElement>('[data-elegido="true"]');
      setIndicador(b ? { x: b.offsetLeft, ancho: b.offsetWidth } : null);
    };
    medir();
    const raf = requestAnimationFrame(() => setAnimar(true));
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    el.querySelectorAll('button').forEach((b) => obs.observe(b));
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [valor, opciones.length]);

  return (
    <div
      ref={caja}
      role={pestanas ? 'tablist' : 'group'}
      aria-label={etiqueta}
      className={`segmentado ${className}`}
    >
      {indicador && (
        <span aria-hidden className="indicador" style={{ width: indicador.ancho, transform: `translateX(${indicador.x}px)`, transition: animar ? undefined : 'none' }} />
      )}
      {opciones.map((o) => {
        const elegido = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            data-elegido={elegido}
            data-sonido="llave"
            role={pestanas ? 'tab' : undefined}
            aria-selected={pestanas ? elegido : undefined}
            aria-pressed={pestanas ? undefined : elegido}
            aria-label={o.etiqueta}
            onClick={() => onCambio(o.valor)}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}
