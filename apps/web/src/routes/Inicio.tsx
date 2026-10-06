import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { Cargando, MensajeError, PantallaMensaje } from '../components/Estado.tsx';
import { useSesion } from '../hooks/useSesion.ts';
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

  if (error) {
    return (
      <PantallaMensaje titulo="No se pudo cargar">
        <MensajeError>{error}</MensajeError>
      </PantallaMensaje>
    );
  }
  if (!datos) return <Cargando />;
  const { membresias, suspendidos, operador } = datos;

  const avisoSuspendidos = suspendidos.length > 0 && (
    <p role="alert" className="max-w-sm rounded-xl border-2 border-red-300 bg-red-50 p-3 font-medium text-red-900">
      {suspendidos.length === 1 ? `"${suspendidos[0]}" está suspendido.` : `Están suspendidos: ${suspendidos.join(', ')}.`}{' '}
      Para volver a usarlo, hablá con Anotado.
    </p>
  );
  const linkPanel = operador && (
    <Link to="/operador" className="rounded-xl bg-stone-900 px-6 py-3 text-lg font-bold text-white">
      Panel de Anotado
    </Link>
  );

  if (membresias.length === 1 && !operador && suspendidos.length === 0) {
    return <Navigate to={`/${membresias[0]!.negocios.slug}`} replace />;
  }
  if (membresias.length === 0) {
    return (
      <PantallaMensaje titulo={suspendidos.length > 0 ? 'Local suspendido' : 'Todavía no tenés un local'}>
        {avisoSuspendidos}
        {linkPanel}
        {suspendidos.length === 0 && (
          <>
            <p className="max-w-sm text-stone-600">
              Si trabajás en uno, pedile al dueño un link de invitación. Si es tu local y tenés un código de Anotado:
            </p>
            <Link to="/registro" className="rounded-xl bg-indigo-600 px-6 py-3 text-lg font-bold text-white">
              Dar de alta mi local
            </Link>
          </>
        )}
        <BotonSalir />
      </PantallaMensaje>
    );
  }
  return (
    <PantallaMensaje titulo="Elegí el local">
      {avisoSuspendidos}
      <ul className="flex w-full max-w-sm flex-col gap-3">
        {membresias.map((m) => (
          <li key={m.negocios.slug}>
            <Link
              to={`/${m.negocios.slug}`}
              className="block rounded-xl border-2 border-stone-300 bg-white p-4 text-lg font-bold"
            >
              {m.negocios.nombre}
            </Link>
          </li>
        ))}
      </ul>
      {linkPanel}
      <Link to="/registro" className="font-medium text-stone-600 underline">
        Dar de alta otro local
      </Link>
    </PantallaMensaje>
  );
}
