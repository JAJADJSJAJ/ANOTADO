import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useIndicador } from '../hooks/useIndicador.ts';
import { Icono, type NombreIcono } from '../components/Icono.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { Letras3D } from '../components/Letras3D.tsx';

type Seccion = { ruta: string; texto: string; icono: NombreIcono; enDemo?: boolean };

/** Lo que configura el dueño, separado de las pantallas de trabajo. */
const SECCIONES: { grupo: string; items: Seccion[] }[] = [
  {
    grupo: 'Local',
    items: [
      { ruta: 'menu', texto: 'Menú', icono: 'menu', enDemo: true },
      { ruta: 'equipo', texto: 'Equipo', icono: 'equipo' },
      { ruta: 'horarios', texto: 'Horarios', icono: 'reloj' },
    ],
  },
  {
    grupo: 'Pedidos',
    items: [
      { ruta: 'envios', texto: 'Envíos', icono: 'moto' },
      { ruta: 'cocina', texto: 'Cocina', icono: 'cocina' },
      { ruta: 'automatico', texto: 'Confirmación automática', icono: 'check' },
      { ruta: 'pagos', texto: 'Formas de pago', icono: 'billete' },
      { ruta: 'ia', texto: 'IA de WhatsApp', icono: 'chispa' },
    ],
  },
];

const item =
  'flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold text-tinta-2 hover:text-tinta aria-[current=page]:text-tinta';

export function AdminLayout() {
  const { esDemo } = useNegocio();
  const secciones = SECCIONES.map((s) => ({ ...s, items: s.items.filter((i) => !esDemo || i.enDemo) })).filter(
    (s) => s.items.length > 0,
  );
  const { pathname } = useLocation();
  // La hoja blanca detrás del ítem activo se desliza (y gira apenas) al cambiar de sección.
  const { ref, caja, animar } = useIndicador<HTMLDivElement>(pathname);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-3 py-5 sm:px-5 md:flex-row md:gap-10 md:py-8">
      <nav aria-label="Administrar" className="md:sticky md:top-22 md:w-52 md:shrink-0 md:self-start">
        <p className="rotulo mb-3 hidden px-2.5 md:block">Administrar</p>
        <div ref={ref} className="nav-3d relative isolate -mx-3 flex gap-1 overflow-x-auto sin-barra px-3 md:mx-0 md:flex-col md:gap-5 md:overflow-visible md:px-0">
          {secciones.map((s) => (
            <div key={s.grupo} className="flex gap-1 md:flex-col md:gap-0.5">
              <p className="mb-1 hidden px-2.5 text-xs font-semibold text-tinta-3 md:block">{s.grupo}</p>
              {s.items.map((i) => (
                <NavLink key={i.ruta} to={i.ruta} className={`pestana-3d ${item}`}>
                  <Icono nombre={i.icono} className="size-4" />
                  {i.texto}
                </NavLink>
              ))}
            </div>
          ))}
          {caja && (
            <span
              aria-hidden
              className="indicador-3d -z-10"
              style={{
                width: caja.ancho,
                height: caja.alto,
                transform: `translate(${caja.x}px, ${caja.y}px)`,
                transition: animar ? undefined : 'none',
              }}
            >
              <span key={caja.n} className="indicador-3d-cara rounded-lg bg-hoja shadow-[0_1px_2px_rgb(20_20_18/0.12)]" />
            </span>
          )}
        </div>
      </nav>
      {/* Key = sección (/slug/admin/<sección>): sub-rutas no re-montan ni re-animan. */}
      <div key={pathname.split('/')[3]} className="pantalla-3d min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

/** Encabezado de una página de administración: título, una línea de qué es y acciones. */
export function Encabezado({ titulo, children, acciones }: { titulo: string; children?: ReactNode; acciones?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">
          <Letras3D texto={titulo} />
        </h1>
        {children && <p className="mt-1.5 max-w-xl text-tinta-2">{children}</p>}
      </div>
      {acciones}
    </header>
  );
}

/** Bloque de una página de administración, con su título y su explicación. */
export function Bloque({
  titulo,
  descripcion,
  children,
  acciones,
}: {
  titulo?: string;
  descripcion?: ReactNode;
  children: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <section className="tarjeta entra-3d">
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-linea px-5 py-4">
          <div className="min-w-0 flex-1">
            {titulo && <h2 className="font-bold tracking-[-0.01em]">{titulo}</h2>}
            {descripcion && <p className="mt-0.5 text-sm text-tinta-2">{descripcion}</p>}
          </div>
          {acciones}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
