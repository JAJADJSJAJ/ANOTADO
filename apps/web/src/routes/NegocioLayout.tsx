import { leerHorarios } from '@anotado/shared';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useMatch, useParams, useSearchParams } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { BotonSonido } from '../components/BotonSonido.tsx';
import { EsqueletoPagina } from '../components/Esqueletos.tsx';
import { MensajeError, PantallaMensaje } from '../components/Estado.tsx';
import { Fondo3D } from '../components/Fondo3D.tsx';
import { Icono } from '../components/Icono.tsx';
import { Logo } from '../components/Marca.tsx';
import { Tutorial } from '../components/Tutorial.tsx';
import { useIndicador } from '../hooks/useIndicador.ts';
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
  // La cocina ocupa justo el alto de la pantalla (los tickets se desplazan adentro, no la página).
  const enCocina = useMatch('/:negocio/cocina') !== null;
  // Pantalla de primer nivel (mostrador, cocina, admin): cambiar de sección de admin no la re-monta.
  const pantalla = useLocation().pathname.split('/')[2] ?? '';
  // Tutorial de la demo: se monta acá para sobrevivir al cambio de pantalla.
  const [tutorial, setTutorial] = useState(false);
  const [params, setParams] = useSearchParams();
  const [oferta, setOferta] = useState(() => params.get('tutorial') === '1');
  const salirTutorial = useCallback(() => setTutorial(false), []);
  useEffect(() => {
    if (params.get('tutorial') !== '1') return;
    setParams(
      (p) => {
        p.delete('tutorial');
        return p;
      },
      { replace: true },
    );
  }, [params, setParams]);

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
  if (negocio === undefined) return <EsqueletoPagina />;
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
      <Fondo3D />
      <div className={`flex flex-col ${enCocina ? 'h-dvh' : 'min-h-dvh'}`}>
        <Barra negocio={negocio} email={sesion?.user.email ?? ''} onTutorial={() => setTutorial(true)} />
        {/* Cada pantalla entra con un leve giro (key = pantalla). Lo flotante de adentro va por portal. */}
        <div key={pantalla} className="pantalla-3d flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
      {negocio.esDemo && negocio.rol !== 'cocina' && oferta && !tutorial && (
        <OfertaTutorial
          onEmpezar={() => {
            setOferta(false);
            setTutorial(true);
          }}
          onCerrar={() => setOferta(false)}
        />
      )}
      {/* El recorrido pasa por el mostrador: con rol cocina no se ofrece ni se monta. */}
      {negocio.esDemo && negocio.rol !== 'cocina' && tutorial && <Tutorial slug={negocio.slug} onSalir={salirTutorial} />}
    </NegocioContext>
  );
}

/** Pestaña de la barra: se acerca en 3D al pasar el puntero; el subrayado es un indicador aparte. */
const pestana =
  'pestana-3d relative flex h-full shrink-0 items-center gap-2 px-3 text-sm font-semibold text-tinta-2 hover:text-tinta aria-[current=page]:text-tinta';

/**
 * Arriba de todo: a la izquierda el local, en el medio las pantallas de trabajo (las que se
 * usan durante el servicio) y a la derecha, separado, Administrar y la cuenta.
 */
function Barra({ negocio, email, onTutorial }: { negocio: NegocioActual; email: string; onTutorial: () => void }) {
  const { rol, esDemo } = negocio;
  return (
    <header data-tutorial="barra" className="sticky top-0 z-30 border-b border-linea bg-hoja/95 backdrop-blur-[2px]">
      <div className="flex h-14 items-center gap-3 px-3 sm:gap-5 sm:px-5">
        <Link to={`/${negocio.slug}`} className="flex min-w-0 items-center gap-2.5 rounded-lg">
          <Logo className="size-[26px]" />
          <span className="truncate font-bold tracking-[-0.015em]">{negocio.nombre}</span>
          {esDemo && <span className="chip chip-alerta hidden sm:inline-flex">Demo</span>}
        </Link>

        <NavTrabajo rol={rol} className="hidden h-full sm:flex" />

        <div className="ml-auto flex items-center gap-1">
          {esDemo && rol !== 'cocina' && <BotonTutorial onClick={onTutorial} />}
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
      <NavTrabajo rol={rol} className="flex h-11 overflow-x-auto sin-barra border-t border-linea px-1 sm:hidden" />
    </header>
  );
}

/** Pantallas de trabajo con un subrayado que se desliza (y gira apenas) a la activa. */
function NavTrabajo({ rol, className }: { rol: NegocioActual['rol']; className: string }) {
  const { pathname } = useLocation();
  const { ref, caja, animar } = useIndicador<HTMLElement>(pathname);
  return (
    <nav ref={ref} aria-label="Pantallas de trabajo" className={`nav-3d relative items-stretch ${className}`}>
      <PestanasTrabajo rol={rol} />
      {caja && (
        <span
          aria-hidden
          className="indicador-3d"
          style={{
            width: caja.ancho - 24,
            height: 2,
            transform: `translate(${caja.x + 12}px, ${caja.y + caja.alto - 1}px)`,
            transition: animar ? undefined : 'none',
          }}
        >
          <span key={caja.n} className="indicador-3d-cara bg-tinta" />
        </span>
      )}
    </nav>
  );
}

function PestanasTrabajo({ rol }: { rol: NegocioActual['rol'] }) {
  return (
    <>
      {rol !== 'cocina' && (
        <NavLink to="mostrador" className={pestana}>
          Pedidos
        </NavLink>
      )}
      {rol !== 'cajero' && (
        <NavLink to="cocina" data-tutorial="cocina" className={pestana}>
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
        className="menu-3d fixed inset-auto top-[3.75rem] right-3 m-0 w-64 rounded-xl border border-linea bg-hoja p-1.5 text-tinta shadow-alta sm:right-5"
      >
        <div className="menu-3d-item px-2.5 pt-2 pb-2.5">
          <p className="truncate text-sm font-semibold">{email}</p>
          <p className="text-[0.8125rem] text-tinta-3">{rol}</p>
        </div>
        <div className="flex flex-col border-t border-linea pt-1.5">
          <Link to="/" className="menu-3d-item btn btn-fantasma justify-start px-2.5" style={{ '--i': 1 } as CSSProperties}>
            <Icono nombre="tienda" />
            Mis locales
          </Link>
          <span className="menu-3d-item flex flex-col" style={{ '--i': 2 } as CSSProperties}>
            <BotonSalir className="btn-fantasma justify-start px-2.5" />
          </span>
        </div>
      </div>
    </>
  );
}

/** /:negocio a secas: cada rol a su pantalla principal (en la demo también, el local completo). */
export function InicioNegocio() {
  const { rol } = useNegocioActual();
  return <Navigate to={rol === 'cocina' ? 'cocina' : 'mostrador'} replace />;
}

const CLAVE_VISTO = 'anotado:tutorial-visto';

/** Botón de la barra en la demo: late suave hasta que se usa por primera vez. */
function BotonTutorial({ onClick }: { onClick: () => void }) {
  const [nuevo, setNuevo] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_VISTO) === null;
    } catch {
      return false;
    }
  });
  return (
    <button
      type="button"
      data-tutorial="boton-tutorial"
      onClick={() => {
        setNuevo(false);
        try {
          localStorage.setItem(CLAVE_VISTO, '1');
        } catch {
          // Sin almacenamiento: vuelve a latir la próxima vez, nada más.
        }
        onClick();
      }}
      className={`btn btn-birome btn-chico max-sm:w-9 max-sm:px-0 ${nuevo ? 'animate-pulse' : ''}`}
    >
      <Icono nombre="info" />
      <span className="max-sm:sr-only">Tutorial</span>
    </button>
  );
}

/** Cartel chico al llegar con ?tutorial=1: ofrece el recorrido sin imponerlo. */
function OfertaTutorial({ onEmpezar, onCerrar }: { onEmpezar: () => void; onCerrar: () => void }) {
  return (
    <div
      role="dialog"
      aria-labelledby="oferta-tutorial"
      className="fixed inset-x-4 bottom-20 z-50 animate-entra rounded-2xl border border-linea bg-hoja p-4 shadow-alta sm:inset-x-auto sm:top-[4.5rem] sm:right-5 sm:bottom-auto sm:w-80"
    >
      <p id="oferta-tutorial" className="font-bold tracking-[-0.015em]">
        ¿Te muestro cómo funciona?
      </p>
      <p className="mt-0.5 text-sm text-tinta-3">
        <span className="num">40</span> segundos
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="btn btn-fantasma btn-chico">
          Ahora no
        </button>
        <button type="button" onClick={onEmpezar} className="btn btn-birome btn-chico" autoFocus>
          Empezar
        </button>
      </div>
    </div>
  );
}
