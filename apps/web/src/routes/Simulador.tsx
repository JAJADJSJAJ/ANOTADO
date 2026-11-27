import { Navigate } from 'react-router';

/** Ruta vieja de la demo guiada: ahora la demo es el local completo (con tutorial). */
export function Simulador() {
  return <Navigate to="../mostrador" replace />;
}
