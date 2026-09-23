import { formatearPrecio, type Tables } from '@anotado/shared';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';

type Pedido = Pick<Tables<'pedidos'>, 'id' | 'numero' | 'created_at' | 'total_centavos' | 'estado' | 'origen'>;

const ESTADOS: Record<Pedido['estado'], string> = {
  pendiente: 'Pendiente',
  en_cocina: 'En cocina',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** Últimos pedidos del local, para que el cajero confirme que el suyo quedó. */
export function UltimosPedidos({ negocioId, version }: { negocioId: string; version: number }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);

  useEffect(() => {
    void supabase
      .from('pedidos')
      .select('id, numero, created_at, total_centavos, estado, origen')
      .eq('negocio_id', negocioId)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setPedidos(data ?? []));
  }, [negocioId, version]);

  if (pedidos.length === 0) return null;

  return (
    <section aria-label="Últimos pedidos" className="rounded-xl bg-white p-4">
      <h2 className="mb-2 text-lg font-bold">Últimos pedidos</h2>
      <ul className="divide-y divide-neutral-200">
        {pedidos.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <span className="w-12 text-xl font-black">#{p.numero}</span>
            <span className="text-neutral-600">
              {new Date(p.created_at).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-neutral-600">{ESTADOS[p.estado]}</span>
            <span className="ml-auto font-bold">{formatearPrecio(p.total_centavos)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
