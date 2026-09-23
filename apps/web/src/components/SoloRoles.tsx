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
    return <p className="p-8 text-center text-lg text-neutral-600">Esta pantalla no está disponible para tu rol.</p>;
  }
  return children;
}
