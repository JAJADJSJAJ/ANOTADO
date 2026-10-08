import { leerHorarios } from '@anotado/shared';
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useParams } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { BotonSonido } from '../components/BotonSonido.tsx';
import { Cargando, MensajeError, PantallaMensaje } from '../components/Estado.tsx';
import { Icono } from '../components/Icono.tsx';
import { Logo } from '../components/Marca.tsx';
import { useNegocio as useNegocioActual } from '../hooks/useNegocio.ts';
import { useSesion } from '../hooks/useSesion.ts';
import { type NegocioActual, NegocioContext, NOMBRE_ROL } from '../lib/contextos.ts';
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
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!slug || !userId) return;
    void supabase
      .from('negocios')
      .select('id, nombre, slug, ia_permitida, ia_activa, config, horarios, zona_horaria, es_demo, miembros!inner(rol)')
      .eq('slug', slug)
      .eq('miembros.user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        const rol = data?.miembros[0]?.rol;
        setNegocio(
          data && rol
            ? {
                id: data.id,
                nombre: data.nombre,
                slug: data.slug,
                rol,
                iaPermitida: data.ia_permitida,
                iaActiva: data.ia_activa,
                config: data.config,
                horarios: leerHorarios(data.horarios),
                zonaHoraria: data.zona_horaria,
                esDemo: data.es_demo,
                recargar: () => setVersion((v) => v + 1),
              }
            : null,
        );
      });
  }, [slug, userId, version]);

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
        <p className="text-tinta-2">No existe o no tenés acceso.</p>
        <div className="flex gap-2">
          <Link to="/" className="btn">
            Mis locales
          </Link>
          <BotonSalir className="" />
        </div>
      </PantallaMensaje>
    );
  }

  return (
    <NegocioContext value={negocio}>
      <div className="flex min-h-dvh flex-col">
        <Barra negocio={negocio} email={sesion?.user.email ?? ''} />
        <Outlet />
      </div>
    </NegocioContext>
  );
}

/** Pestaña de la barra: subrayado en tinta que se dibuja de izquierda a derecha. */
const pestana =
  'relative flex h-full shrink-0 items-center gap-2 px-3 text-sm font-semibold text-tinta-2 transition-colors hover:text-tinta aria-[current=page]:text-tinta ' +
  'after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:origin-left after:scale-x-0 after:bg-tinta after:transition-transform after:duration-300 after:ease-salida aria-[current=page]:after:scale-x-100';

/**
 * Arriba de todo: a la izquierda el local, en el medio las pantallas de trabajo (las que se
 * usan durante el servicio) y a la derecha, separado, Administrar y la cuenta.
 */
function Barra({ negocio, email }: { negocio: NegocioActual; email: string }) {
  const { rol, esDemo } = negocio;
  return (
    <header className="sticky top-0 z-30 border-b border-linea bg-hoja/95 backdrop-blur-[2px]">
      <div className="flex h-14 items-center gap-3 px-3 sm:gap-5 sm:px-5">
        <Link to={`/${negocio.slug}`} className="flex min-w-0 items-center gap-2.5 rounded-lg">
          <Logo className="size-[26px]" />
          <span className="truncate font-bold tracking-[-0.015em]">{negocio.nombre}</span>
          {esDemo && <span className="chip chip-alerta hidden sm:inline-flex">Demo</span>}
        </Link>

        <nav aria-label="Pantallas de trabajo" className="hidden h-full items-stretch sm:flex">
          <PestanasTrabajo rol={rol} esDemo={esDemo} />
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {rol === 'dueno' && (
            <NavLink to="admin" className={({ isActive }) => `btn btn-chico ${isActive ? 'btn-tinta' : 'btn-fantasma'} max-sm:w-9 max-sm:px-0`}>
              <Icono nombre="ajustes" />
              <span className="max-sm:sr-only">Administrar</span>
            </NavLink>
          )}
          <BotonSonido />
          <Cuenta email={email} rol={NOMBRE_ROL[rol]} />
        </div>
      </div>
      {/* En el celular las pantallas de trabajo van en una segunda fila. */}
      <nav aria-label="Pantallas de trabajo" className="flex h-11 items-stretch overflow-x-auto sin-barra border-t border-linea px-1 sm:hidden">
        <PestanasTrabajo rol={rol} esDemo={esDemo} />
      </nav>
    </header>
  );
}

function PestanasTrabajo({ rol, esDemo }: { rol: NegocioActual['rol']; esDemo: boolean }) {
  return (
    <>
      {esDemo && rol !== 'cocina' && (
        <NavLink to="simulador" className={pestana}>
          Demo
        </NavLink>
      )}
      {rol !== 'cocina' && (
        <NavLink to="mostrador" className={pestana}>
          Pedidos
        </NavLink>
      )}
      {rol !== 'cajero' && (
        <NavLink to="cocina" className={pestana}>
          Cocina
        </NavLink>
      )}
    </>
  );
}

/** Menú de la cuenta: quién entró, con qué rol, cambiar de local y salir. */
function Cuenta({ email, rol }: { email: string; rol: string }) {
  const inicial = (email.charAt(0) || '?').toUpperCase();
  return (
    <>
      <button
        type="button"
        popoverTarget="menu-cuenta"
        aria-label="Cuenta"
        className="ml-1 grid size-8 place-items-center rounded-full bg-tinta text-[0.8125rem] font-bold text-white transition-transform active:scale-95"
      >
        {inicial}
      </button>
      <div
        id="menu-cuenta"
        popover="auto"
        className="fixed inset-auto top-[3.75rem] right-3 m-0 w-64 rounded-xl border border-linea bg-hoja p-1.5 text-tinta shadow-alta transition-[opacity,translate,display] transition-discrete duration-150 ease-salida starting:open:-translate-y-1 starting:open:opacity-0 sm:right-5"
      >
        <div className="px-2.5 pt-2 pb-2.5">
          <p className="truncate text-sm font-semibold">{email}</p>
          <p className="text-[0.8125rem] text-tinta-3">{rol}</p>
        </div>
        <div className="flex flex-col border-t border-linea pt-1.5">
          <Link to="/" className="btn btn-fantasma justify-start px-2.5">
            <Icono nombre="tienda" />
            Mis locales
          </Link>
          <BotonSalir className="btn-fantasma justify-start px-2.5" />
        </div>
      </div>
    </>
  );
}

/** /:negocio a secas: cada rol a su pantalla principal (en la demo, el simulador). */
export function InicioNegocio() {
  const { rol, esDemo } = useNegocioActual();
  if (esDemo && rol !== 'cocina') return <Navigate to="simulador" replace />;
  return <Navigate to={rol === 'cocina' ? 'cocina' : 'mostrador'} replace />;
}
