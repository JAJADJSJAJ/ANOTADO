import type { Tables } from '@anotado/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';

export type Zona = Tables<'zonas_envio'>;

type Resultado = { zonas: Zona[]; error: string | null };

async function cargarZonas(negocioId: string): Promise<Resultado> {
  const { data, error } = await supabase
    .from('zonas_envio')
    .select('*')
    .eq('negocio_id', negocioId)
    .order('orden')
    .order('nombre');
  return { zonas: data ?? [], error: error?.message ?? null };
}

/** Zonas de envío del local (activas e inactivas). Cocina no las ve: le llega una lista vacía. */
export function useZonas(negocioId: string) {
  const [estado, setEstado] = useState<Resultado>({ zonas: [], error: null });

  useEffect(() => {
    void cargarZonas(negocioId).then(setEstado);
  }, [negocioId]);

  const recargar = useCallback(async () => setEstado(await cargarZonas(negocioId)), [negocioId]);

  return { ...estado, recargar };
}
