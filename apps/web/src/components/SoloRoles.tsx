import type { ReactNode } from 'react';
import { useNegocio } from '../hooks/useNegocio.ts';
import type { Rol } from '../lib/contextos.ts';

/**
 * Oculta una pantalla a los roles que no la usan. Es solo UX: los permisos reales los
 * hacen cumplir RLS y las RPC en la base.
 */
export function SoloRoles({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { rol } = useNegocio();
  if (!roles.includes(rol)) {
    return <p className="p-8 text-center text-lg text-stone-600">Esta pantalla no está disponible para tu rol.</p>;
  }
  return children;
}

/** Pantallas que en la demo están cerradas (equipo, ajustes). También lo frena la base. */
export function SinDemo({ children }: { children: ReactNode }) {
  const { esDemo } = useNegocio();
  if (esDemo) return <p className="p-8 text-center text-lg text-stone-600">En la demo esta pantalla está cerrada.</p>;
  return children;
}
