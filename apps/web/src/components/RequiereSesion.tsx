import { Navigate, Outlet, useLocation } from 'react-router';
import { useSesion } from '../hooks/useSesion.ts';
import { EsqueletoPagina } from './Esqueletos.tsx';

/** Rutas que necesitan login. Sin sesión, manda a /login y vuelve después. */
export function RequiereSesion() {
  const sesion = useSesion();
  const location = useLocation();

  if (sesion === undefined) return <EsqueletoPagina />;
  if (!sesion) return <Navigate to="/login" replace state={{ desde: location.pathname }} />;
  return <Outlet />;
}
