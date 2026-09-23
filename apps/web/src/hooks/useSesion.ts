import { useContext } from 'react';
import { SesionContext } from '../lib/contextos.ts';

export function useSesion() {
  return useContext(SesionContext);
}
