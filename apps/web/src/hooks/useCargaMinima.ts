import { useEffect, useState } from 'react';

const MENOS_MOVIMIENTO = '(prefers-reduced-motion: reduce)';

/**
 * Un poquito de tiempo de carga "por gusto": devuelve true recién cuando `listo` y además
 * pasaron al menos `ms` desde el montaje, así el esqueleto se alcanza a ver y no parpadea.
 * Con menos movimiento pedido, espera bastante menos (200ms).
 */
export function useCargaMinima(listo: boolean, ms = 700): boolean {
  const [cumplido, setCumplido] = useState(false);

  // El reloj arranca al montar (el efecto corre apenas después del primer render).
  useEffect(() => {
    const reducido = typeof matchMedia === 'function' && matchMedia(MENOS_MOVIMIENTO).matches;
    const t = setTimeout(() => setCumplido(true), reducido ? Math.min(ms, 200) : ms);
    return () => clearTimeout(t);
  }, [ms]);

  return listo && cumplido;
}
