import type { Database } from '@anotado/shared';
import type { Session } from '@supabase/supabase-js';
import { createContext } from 'react';

export type Rol = Database['public']['Enums']['rol_miembro'];

/** undefined = todavía cargando la sesión. */
export const SesionContext = createContext<Session | null | undefined>(undefined);

export type NegocioActual = {
  id: string;
  nombre: string;
  slug: string;
  rol: Rol;
  /** La IA la habilita el operador de Anotado; el dueño no puede cambiarlo. */
  iaPermitida: boolean;
  /** La prende o la apaga el dueño. La IA funciona solo con las dos en true. */
  iaActiva: boolean;
  /** negocios.config (jsonb libre): se lee siempre con un schema y valores por defecto. */
  config: unknown;
  /** Vuelve a leer el negocio (después de guardar ajustes). */
  recargar: () => void;
};

export const NegocioContext = createContext<NegocioActual | null>(null);
