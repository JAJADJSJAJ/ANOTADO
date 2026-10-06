import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { Cargando, MensajeError, PantallaMensaje } from '../components/Estado.tsx';
import { useSesion } from '../hooks/useSesion.ts';
import { supabase } from '../lib/supabase.ts';

type Membresia = { negocios: { nombre: string; slug: string } };

/** Después del login: si el usuario tiene un solo negocio, entra directo. */
export function Inicio() {
  const sesion = useSesion();
  const [membresias, setMembresias] = useState<Membresia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = sesion?.user.id;

  useEffect(() => {
    if (!userId) return;
    void supabase
      .from('miembros')
      .select('negocios!inner(nombre, slug)')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setMembresias(data);
      });
  }, [userId]);

  if (error) {
    return (
      <PantallaMensaje titulo="No se pudo cargar">
        <MensajeError>{error}</MensajeError>
      </PantallaMensaje>
    );
  }
  if (!membresias) return <Cargando />;
  if (membresias.length === 1) return <Navigate to={`/${membresias[0]!.negocios.slug}`} replace />;
  if (membresias.length === 0) {
    return (
      <PantallaMensaje titulo="Todavía no tenés un local">
        <p className="max-w-sm text-stone-600">
          Si trabajás en uno, pedile al dueño un link de invitación. Si es tu local y tenés un código de Anotado:
        </p>
        <Link to="/registro" className="rounded-xl bg-indigo-600 px-6 py-3 text-lg font-bold text-white">
          Dar de alta mi local
        </Link>
        <BotonSalir />
      </PantallaMensaje>
    );
  }
  return (
    <PantallaMensaje titulo="Elegí el local">
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
      <Link to="/registro" className="font-medium text-stone-600 underline">
        Dar de alta otro local
      </Link>
    </PantallaMensaje>
  );
}
