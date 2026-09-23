import { useContext } from 'react';
import { NegocioContext } from '../lib/contextos.ts';

/** Negocio de la ruta actual. Solo se usa dentro de NegocioLayout. */
export function useNegocio() {
  const negocio = useContext(NegocioContext);
  if (!negocio) throw new Error('useNegocio fuera de NegocioLayout');
  return negocio;
}
