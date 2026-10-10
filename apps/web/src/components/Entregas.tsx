import {
  ETIQUETA_ESTADO,
  EntregaSchema,
  formatearPrecio,
  minutosDesde,
  type PedidoCocina,
  puedeAvanzar,
  puedeCancelar,
  textoEntrega,
} from '@anotado/shared';
import { useEffect, useState } from 'react';
import { useAhora } from '../hooks/useAhora.ts';
import { useAvisos } from '../hooks/useAvisos.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import type { usePedidosCocina } from '../hooks/usePedidosCocina.ts';
import { usePreguntar } from '../lib/dialogos.ts';
import { cancelarPedido, moverPedido } from '../lib/estados.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { ListaAvisos } from './Avisos.tsx';
import { Cargando, MensajeError, Vacio } from './Estado.tsx';
import { Icono } from './Icono.tsx';

type DatosMostrador = { direccion: string | null; total: number };

/**
 * Pestaña Entregas del mostrador: lo que está listo para entregar o retirar, y lo que
 * todavía está en cocina (para cancelar si el cliente se arrepiente).
 */
export function Entregas({ cocina }: { cocina: ReturnType<typeof usePedidosCocina> }) {
  const negocio = useNegocio();
  const { pedidos, desfase, error, recargar, actualizarLocal } = cocina;
  const ahora = useAhora(desfase);
  const { avisos, avisar, quitar } = useAvisos();
  const preguntar = usePreguntar();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const datos = useDatosMostrador(pedidos);

  async function entregar(p: PedidoCocina, accion: 'avanzar' | 'retroceder') {
    setOcupado(p.id);
    const r = await moverPedido(accion, p.id, p.estado);
    setOcupado(null);
    if (!r.ok) {
      efecto('error');
      return avisar({ tipo: 'error', clave: p.id, texto: r.error });
    }
    actualizarLocal(p.id, { estado: r.estado });
    if (r.cambiado && accion === 'avanzar') {
      efecto('sello');
      avisar({
        tipo: 'deshacer',
        clave: p.id,
        texto: `#${p.numero} entregado`,
        deshacer: () => void entregar({ ...p, estado: r.estado }, 'retroceder'),
      });
    } else if (!r.cambiado) {
      avisar({ tipo: 'info', clave: p.id, texto: `El #${p.numero} ya estaba en "${ETIQUETA_ESTADO[r.estado]}".` });
    }
    void recargar();
  }

  async function cancelar(p: PedidoCocina) {
    const motivo = await preguntar({
      titulo: `¿Cancelar el pedido #${p.numero}?`,
      texto: 'Sale de la cocina al instante y no se puede deshacer. Si ya se cobró, la devolución se hace por fuera de Anotado.',
      aceptar: 'Sí, cancelar',
      peligro: true,
      campo: { etiqueta: 'Motivo (opcional)', placeholder: 'El cliente se arrepintió', maxLength: 200 },
    });
    if (motivo === null) return;
    setOcupado(p.id);
    const r = await cancelarPedido(p.id, motivo);
    setOcupado(null);
    if (!r.ok) {
      efecto('error');
      return avisar({ tipo: 'error', clave: p.id, texto: r.error });
    }
    actualizarLocal(p.id, { estado: 'cancelado' });
    avisar({ tipo: 'info', clave: p.id, texto: `Pedido #${p.numero} cancelado. La cocina ya lo sabe.` });
    void recargar();
  }

  if (!pedidos) return error ? <MensajeError>{error}</MensajeError> : <Cargando />;

  const listos = pedidos.filter((p) => p.estado === 'listo');
  const enCocina = pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'en_cocina');

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Listos para entregar">
        <Titulo texto="Listos para entregar" cantidad={listos.length} />
        {listos.length === 0 ? (
          <div className="tarjeta flex">
            <Vacio icono="check" titulo="Nada listo por ahora">
              Cuando la cocina marque un pedido como listo, aparece acá.
            </Vacio>
          </div>
        ) : (
          <ul className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {listos.map((p) => {
              const extra = datos.get(p.id);
              return (
                <li key={p.id} className="tarjeta flex animate-entra flex-col overflow-hidden border-t-[3px] border-t-ok">
                  <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
                    <div>
                      <p className="num text-[2rem] leading-none font-extrabold tracking-tight">#{p.numero}</p>
                      <p className="mt-1.5 text-sm font-semibold text-tinta-2">{textoEntrega(p)}</p>
                    </div>
                    {extra && <p className="num pt-1 text-lg font-bold">{formatearPrecio(extra.total)}</p>}
                  </div>
                  {extra?.direccion && (
                    <p className="mx-4 mt-2 flex items-start gap-1.5 text-sm">
                      <Icono nombre="ubicacion" className="mt-px size-4 text-tinta-3" />
                      {extra.direccion}
                    </p>
                  )}
                  <p className="mx-4 mt-2.5 border-t border-dashed border-linea-fuerte pt-2.5 text-sm text-tinta-2">
                    {p.items.map((i) => `${i.cantidad} ${i.nombre}`).join(' · ')}
                  </p>
                  <div className="mt-auto flex gap-2 p-3 pt-4">
                    {puedeAvanzar(negocio.rol, p.estado) && (
                      <button
                        type="button"
                        disabled={ocupado === p.id}
                        onClick={() => void entregar(p, 'avanzar')}
                        data-sonido="no"
                        className="btn btn-tinta flex-1"
                      >
                        <Icono nombre="check" />
                        Entregado
                      </button>
                    )}
                    {puedeCancelar(negocio.rol, p.estado) && (
                      <button type="button" disabled={ocupado === p.id} onClick={() => void cancelar(p)} className="btn btn-quitar">
                        Cancelar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="En cocina">
        <Titulo texto="En cocina" cantidad={enCocina.length} />
        {enCocina.length === 0 ? (
          <p className="text-sm text-tinta-3">No hay pedidos en cocina.</p>
        ) : (
          <ul className="tarjeta divide-y divide-linea">
            {enCocina.map((p) => (
              <li key={p.id} className="flex animate-entra items-center gap-3 px-4 py-2.5">
                <span className="num w-14 text-lg font-extrabold">#{p.numero}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-tinta-2">{textoEntrega(p)}</span>
                <span className={`chip chip-punto ${p.estado === 'en_cocina' ? 'chip-birome' : ''}`}>
                  {p.estado === 'en_cocina' ? 'En preparación' : 'Esperando'}
                </span>
                <span className="num w-14 text-right text-sm text-tinta-3">{minutosDesde(p.created_at, ahora)} min</span>
                {puedeCancelar(negocio.rol, p.estado) && (
                  <button type="button" disabled={ocupado === p.id} onClick={() => void cancelar(p)} className="btn btn-quitar btn-chico">
                    Cancelar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ListaAvisos avisos={avisos} onCerrar={quitar} />
    </div>
  );
}

function Titulo({ texto, cantidad }: { texto: string; cantidad: number }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-2 font-bold tracking-[-0.01em]">
      {texto}
      {cantidad > 0 && <span className="num text-sm font-semibold text-tinta-3">{cantidad}</span>}
    </h2>
  );
}

/** Dirección y total de los listos: el cajero los necesita para entregar (cocina no los ve). */
function useDatosMostrador(pedidos: PedidoCocina[] | null) {
  const [datos, setDatos] = useState<ReadonlyMap<string, DatosMostrador>>(new Map());
  const ids = (pedidos ?? [])
    .filter((p) => p.estado === 'listo')
    .map((p) => p.id)
    .sort()
    .join(',');

  useEffect(() => {
    if (!ids) return;
    void supabase
      .from('pedidos')
      .select('id, entrega, total_centavos')
      .in('id', ids.split(','))
      .then(({ data }) => {
        const m = new Map<string, DatosMostrador>();
        for (const p of data ?? []) {
          const entrega = EntregaSchema.safeParse(p.entrega);
          const direccion = entrega.success && entrega.data.modo === 'delivery' ? entrega.data.direccion : null;
          m.set(p.id, { direccion, total: p.total_centavos });
        }
        setDatos(m);
      });
  }, [ids]);

  return datos;
}
