import type { ReactNode } from 'react';
import { useNegocio } from '../hooks/useNegocio.ts';
import type { Rol } from '../lib/contextos.ts';
import { Vacio } from './Estado.tsx';

/**
 * Oculta una pantalla a los roles que no la usan. Es solo UX: los permisos reales los
 * hacen cumplir RLS y las RPC en la base.
 */
export function SoloRoles({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { rol } = useNegocio();
  if (!roles.includes(rol)) {
    return <Vacio icono="llave" titulo="Esta pantalla no está disponible para tu rol" className="py-16" />;
  }
  return children;
}

/** Pantallas que en la demo están cerradas (equipo, ajustes). También lo frena la base. */
export function SinDemo({ children }: { children: ReactNode }) {
  const { esDemo } = useNegocio();
  if (esDemo) return <Vacio icono="llave" titulo="En la demo esta pantalla está cerrada" className="py-16" />;
  return children;
}
