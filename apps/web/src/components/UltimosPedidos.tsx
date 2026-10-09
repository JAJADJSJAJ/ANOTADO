import { ETIQUETA_ESTADO, ETIQUETA_ORIGEN, formatearPrecio, type Tables } from '@anotado/shared';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';

type Pedido = Pick<Tables<'pedidos'>, 'id' | 'numero' | 'created_at' | 'total_centavos' | 'estado' | 'origen' | 'automatico'>;

const CHIP: Partial<Record<Pedido['estado'], string>> = {
  en_cocina: 'chip-birome',
  listo: 'chip-ok',
  cancelado: 'chip-peligro',
};

/** Últimos pedidos del local, para que el cajero confirme que el suyo quedó. */
export function UltimosPedidos({ negocioId, version }: { negocioId: string; version: number }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);

  useEffect(() => {
    void supabase
      .from('pedidos')
      .select('id, numero, created_at, total_centavos, estado, origen, automatico')
      .eq('negocio_id', negocioId)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setPedidos(data ?? []));
  }, [negocioId, version]);

  if (pedidos.length === 0) return null;

  return (
    <section aria-label="Últimos pedidos">
      <h2 className="mb-3 font-bold tracking-[-0.01em]">Últimos pedidos</h2>
      <ul className="tarjeta divide-y divide-linea">
        {pedidos.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="num w-14 text-base font-bold">#{p.numero}</span>
            <span className="num w-12 text-tinta-3">
              {new Date(p.created_at).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
            </span>
            <span className="hidden min-w-0 flex-1 truncate text-tinta-2 @md:block">
              {ETIQUETA_ORIGEN[p.origen]}
              {p.automatico && <span className="text-tinta-3"> · se confirmó solo</span>}
            </span>
            <span className={`chip ml-auto @md:ml-0 ${CHIP[p.estado] ?? ''}`}>{ETIQUETA_ESTADO[p.estado]}</span>
            <span className="num w-20 text-right font-semibold">{formatearPrecio(p.total_centavos)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
