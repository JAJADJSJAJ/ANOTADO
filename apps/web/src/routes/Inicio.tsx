import { type CSSProperties, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { EsqueletoLocales } from '../components/Esqueletos.tsx';
import { useCargaMinima } from '../hooks/useCargaMinima.ts';
import { MensajeError, Nota, PantallaMensaje } from '../components/Estado.tsx';
import { Icono } from '../components/Icono.tsx';
import { Letras3D } from '../components/Letras3D.tsx';
import { Marca } from '../components/Marca.tsx';
import { useSesion } from '../hooks/useSesion.ts';
import { useTilt3D } from '../hooks/useTilt3D.ts';
import { supabase } from '../lib/supabase.ts';

type Membresia = { negocios: { nombre: string; slug: string } };
type Datos = { membresias: Membresia[]; suspendidos: string[]; operador: boolean };

async function cargarInicio(userId: string): Promise<Datos | string> {
  const [m, s, o] = await Promise.all([
    supabase.from('miembros').select('negocios!inner(nombre, slug)').eq('user_id', userId),
    supabase.rpc('mis_locales_suspendidos'),
    supabase.rpc('mi_estado_operador'),
  ]);
  const error = m.error ?? s.error ?? o.error;
  if (error) return error.message;
  return {
    membresias: m.data ?? [],
    suspendidos: (s.data ?? []).map((r) => r.nombre),
    operador: (o.data as { operador?: boolean } | null)?.operador === true,
  };
}

/**
 * Después del login: si el usuario tiene un solo local, entra directo. El operador de Anotado
 * no entra directo: ve sus locales y el link al panel.
 */
export function Inicio() {
  const sesion = useSesion();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = sesion?.user.id;

  useEffect(() => {
    if (!userId) return;
    void cargarInicio(userId).then((r) => (typeof r === 'string' ? setError(r) : setDatos(r)));
  }, [userId]);

  const listo = useCargaMinima(datos !== null);

  if (error) {
    return (
      <PantallaMensaje titulo="No se pudo cargar">
        <MensajeError>{error}</MensajeError>
      </PantallaMensaje>
    );
  }
  if (!datos || !listo) return <EsqueletoLocales />;
  const { membresias, suspendidos, operador } = datos;

  if (membresias.length === 1 && !operador && suspendidos.length === 0) {
    return <Navigate to={`/${membresias[0]!.negocios.slug}`} replace />;
  }

  const avisoSuspendidos = suspendidos.length > 0 && (
    <Nota tono="peligro" rol="alert">
      {suspendidos.length === 1 ? `"${suspendidos[0]}" está suspendido.` : `Están suspendidos: ${suspendidos.join(', ')}.`} Para
      volver a usarlo, hablá con Anotado.
    </Nota>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
      <header className="flex items-center justify-between">
        <Marca />
        <BotonSalir />
      </header>
      <div className="flex flex-1 flex-col justify-center gap-6 py-12">
        {membresias.length === 0 ? (
          <div>
            <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">
              <Letras3D texto={suspendidos.length > 0 ? 'Local suspendido' : 'Todavía no tenés un local'} />
            </h1>
            {suspendidos.length === 0 && (
              <p className="mt-2 text-tinta-2">
                Si trabajás en uno, pedile al dueño un link de invitación. Si es tu local y tenés un código de Anotado, dalo de
                alta.
              </p>
            )}
          </div>
        ) : (
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">
            <Letras3D texto="Elegí el local" />
          </h1>
        )}
        {avisoSuspendidos}

        {membresias.length > 0 && (
          <ul className="flex flex-col gap-2">
            {membresias.map((m, i) => (
              <FilaLocal key={m.negocios.slug} slug={m.negocios.slug} nombre={m.negocios.nombre} i={i} />
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          {operador && (
            <Link to="/operador" className="btn btn-tinta btn-grande w-full">
              <Icono nombre="llave" />
              Panel de Anotado
            </Link>
          )}
          {suspendidos.length === 0 && (
            <Link to="/registro" className={`btn btn-grande w-full ${membresias.length === 0 && !operador ? 'btn-tinta' : ''}`}>
              <Icono nombre="mas" />
              {membresias.length === 0 ? 'Dar de alta mi local' : 'Dar de alta otro local'}
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

/** Un local de la lista: tarjeta que se inclina con el mouse; la inicial y la flecha flotan más cerca. */
function FilaLocal({ slug, nombre, i }: { slug: string; nombre: string; i: number }) {
  const cara = useTilt3D<HTMLAnchorElement>(5);
  return (
    <li className="tilt-3d tilt-3d-capas entra-3d" style={{ '--i': i } as CSSProperties}>
      <Link
        ref={cara}
        to={`/${slug}`}
        className="tilt-3d-cara tarjeta flex items-center gap-3 px-4 py-3.5"
      >
        <span aria-hidden className="capa-z-2 grid size-9 place-items-center rounded-lg bg-tinta text-sm font-bold text-white">
          {nombre.charAt(0).toUpperCase()}
        </span>
        <span className="capa-z min-w-0 flex-1 truncate font-semibold">{nombre}</span>
        <Icono nombre="derecha" className="capa-z-2 size-4 text-tinta-3" />
      </Link>
    </li>
  );
}
