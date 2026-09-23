import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useParams } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { Cargando, MensajeError, PantallaMensaje } from '../components/Estado.tsx';
import { useNegocio as useNegocioActual } from '../hooks/useNegocio.ts';
import { useSesion } from '../hooks/useSesion.ts';
import { type NegocioActual, NegocioContext } from '../lib/contextos.ts';
import { supabase } from '../lib/supabase.ts';

/**
 * Carga el negocio del slug y el rol del usuario. RLS ya impide ver negocios ajenos:
 * si no aparece, o no existe o no sos miembro (se muestra lo mismo a propósito).
 */
export function NegocioLayout() {
  const { negocio: slug } = useParams();
  const sesion = useSesion();
  const userId = sesion?.user.id;
  const [negocio, setNegocio] = useState<NegocioActual | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !userId) return;
    void supabase
      .from('negocios')
      .select('id, nombre, slug, miembros!inner(rol)')
      .eq('slug', slug)
      .eq('miembros.user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        const rol = data?.miembros[0]?.rol;
        setNegocio(data && rol ? { id: data.id, nombre: data.nombre, slug: data.slug, rol } : null);
      });
  }, [slug, userId]);

  if (error) {
    return (
      <PantallaMensaje titulo="No se pudo cargar">
        <MensajeError>{error}</MensajeError>
      </PantallaMensaje>
    );
  }
  if (negocio === undefined) return <Cargando />;
  if (negocio === null) {
    return (
      <PantallaMensaje titulo="Local no encontrado">
        <p className="text-neutral-600">No existe o no tenés acceso.</p>
        <BotonSalir />
      </PantallaMensaje>
    );
  }

  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-4 py-2 font-bold ${isActive ? 'bg-white text-neutral-900' : 'text-neutral-200'}`;

  return (
    <NegocioContext value={negocio}>
      <div className="flex min-h-screen flex-col bg-neutral-100 text-neutral-900">
        <header className="flex flex-wrap items-center gap-2 bg-neutral-900 px-4 py-2 text-white">
          <span className="mr-2 text-lg font-bold">{negocio.nombre}</span>
          <nav className="flex gap-1">
            {negocio.rol !== 'cocina' && (
              <NavLink to="mostrador" className={tab}>
                Mostrador
              </NavLink>
            )}
            {negocio.rol === 'dueno' && (
              <NavLink to="admin/menu" className={tab}>
                Menú
              </NavLink>
            )}
          </nav>
          <BotonSalir className="ml-auto text-neutral-300" />
        </header>
        <Outlet />
      </div>
    </NegocioContext>
  );
}

/** /:negocio a secas: cada rol a su pantalla principal. */
export function InicioNegocio() {
  const { rol } = useNegocioActual();
  if (rol === 'cocina') {
    return <p className="p-8 text-center text-lg text-neutral-600">La pantalla de cocina llega en la Fase 3.</p>;
  }
  return <Navigate to="mostrador" replace />;
}
