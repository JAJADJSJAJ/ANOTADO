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
};

export const NegocioContext = createContext<NegocioActual | null>(null);
