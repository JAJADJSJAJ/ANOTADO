import type { Tables } from '@anotado/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';

export type Categoria = Tables<'categorias'>;
/** quedan: lo que queda hoy si tiene stock del día (lo calcula la base según la jornada del local). */
export type Producto = Tables<'productos'> & { quedan: number | null };

type Resultado = { categorias: Categoria[]; productos: Producto[]; error: string | null };

async function cargarMenu(negocioId: string): Promise<Resultado> {
  const [c, p] = await Promise.all([
    supabase.from('categorias').select('*').eq('negocio_id', negocioId).order('orden').order('nombre'),
    supabase.from('productos').select('*, quedan:stock_disponible').eq('negocio_id', negocioId).order('nombre'),
  ]);
  return {
    categorias: c.data ?? [],
    productos: (p.data ?? []) as unknown as Producto[],
    error: (c.error ?? p.error)?.message ?? null,
  };
}

/** Categorías y productos del negocio (incluye agotados). */
export function useMenu(negocioId: string) {
  const [estado, setEstado] = useState<Resultado & { cargando: boolean }>({
    categorias: [],
    productos: [],
    error: null,
    cargando: true,
  });

  const aplicar = useCallback((r: Resultado) => setEstado({ ...r, cargando: false }), []);

  useEffect(() => {
    void cargarMenu(negocioId).then(aplicar);
  }, [negocioId, aplicar]);

  const recargar = useCallback(async () => aplicar(await cargarMenu(negocioId)), [negocioId, aplicar]);

  return { ...estado, recargar };
}
