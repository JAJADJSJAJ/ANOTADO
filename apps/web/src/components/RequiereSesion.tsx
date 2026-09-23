import { Navigate, Outlet, useLocation } from 'react-router';
import { useSesion } from '../hooks/useSesion.ts';
import { Cargando } from './Estado.tsx';

/** Rutas que necesitan login. Sin sesión, manda a /login y vuelve después. */
export function RequiereSesion() {
  const sesion = useSesion();
  const location = useLocation();

  if (sesion === undefined) return <Cargando />;
  if (!sesion) return <Navigate to="/login" replace state={{ desde: location.pathname }} />;
  return <Outlet />;
}
