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
import { cancelarPedido, moverPedido } from '../lib/estados.ts';
import { supabase } from '../lib/supabase.ts';
import { ListaAvisos } from './Avisos.tsx';
import { Cargando, MensajeError } from './Estado.tsx';

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
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aCancelar, setACancelar] = useState<PedidoCocina | null>(null);
  const datos = useDatosMostrador(pedidos);

  async function entregar(p: PedidoCocina, accion: 'avanzar' | 'retroceder') {
    setOcupado(p.id);
    const r = await moverPedido(accion, p.id, p.estado);
    setOcupado(null);
    if (!r.ok) return avisar({ tipo: 'error', clave: p.id, texto: r.error });
    actualizarLocal(p.id, { estado: r.estado });
    if (r.cambiado && accion === 'avanzar') {
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

  if (!pedidos) return error ? <MensajeError>{error}</MensajeError> : <Cargando />;

  const listos = pedidos.filter((p) => p.estado === 'listo');
  const enCocina = pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'en_cocina');

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Listos para entregar">
        <h2 className="mb-3 text-xl font-black">Listos para entregar</h2>
        {listos.length === 0 ? (
          <p className="rounded-2xl bg-white p-5 text-lg text-stone-500">Nada listo por ahora. Cuando cocina marque uno, aparece acá.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {listos.map((p) => {
              const extra = datos.get(p.id);
              return (
                <li key={p.id} className="flex flex-col gap-3 rounded-2xl border-2 border-emerald-500 bg-white p-4 shadow-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-4xl font-black">#{p.numero}</span>
                    {extra && <span className="text-xl font-bold">{formatearPrecio(extra.total)}</span>}
                  </div>
                  <p className="text-lg font-semibold">
                    {textoEntrega(p)}
                    {extra?.direccion && <span className="block text-stone-600">{extra.direccion}</span>}
                  </p>
                  <p className="text-stone-600">{p.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(' · ')}</p>
                  <div className="mt-auto flex gap-2">
                    {puedeAvanzar(negocio.rol, p.estado) && (
                      <button
                        type="button"
                        disabled={ocupado === p.id}
                        onClick={() => void entregar(p, 'avanzar')}
                        className="flex-1 rounded-xl bg-emerald-600 py-3 text-xl font-bold text-white active:bg-emerald-700 disabled:opacity-60"
                      >
                        Entregado
                      </button>
                    )}
                    {puedeCancelar(negocio.rol, p.estado) && (
                      <button type="button" onClick={() => setACancelar(p)} className="rounded-xl px-3 font-semibold text-red-700">
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
        <h2 className="mb-3 text-xl font-black">En cocina</h2>
        {enCocina.length === 0 ? (
          <p className="rounded-2xl bg-white p-5 text-lg text-stone-500">No hay pedidos en cocina.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-2xl bg-white">
            {enCocina.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-14 text-2xl font-black">#{p.numero}</span>
                <span className="text-stone-600">{textoEntrega(p)}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
                    p.estado === 'en_cocina' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {p.estado === 'en_cocina' ? 'En preparación' : 'Esperando'}
                </span>
                <span className="text-stone-500 tabular-nums">{minutosDesde(p.created_at, ahora)} min</span>
                {puedeCancelar(negocio.rol, p.estado) && (
                  <button type="button" onClick={() => setACancelar(p)} className="ml-auto rounded-lg px-3 py-2 font-semibold text-red-700">
                    Cancelar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {aCancelar && (
        <DialogoCancelar
          pedido={aCancelar}
          onCerrar={() => setACancelar(null)}
          onCancelado={() => {
            actualizarLocal(aCancelar.id, { estado: 'cancelado' });
            avisar({ tipo: 'info', clave: aCancelar.id, texto: `Pedido #${aCancelar.numero} cancelado. Cocina ya lo sabe.` });
            setACancelar(null);
            void recargar();
          }}
        />
      )}
      <ListaAvisos avisos={avisos} onCerrar={quitar} />
    </div>
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

function DialogoCancelar({
  pedido,
  onCerrar,
  onCancelado,
}: {
  pedido: PedidoCocina;
  onCerrar: () => void;
  onCancelado: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setError(null);
    const r = await cancelarPedido(pedido.id, motivo);
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    onCancelado();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Cancelar pedido ${pedido.numero}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCerrar}>
      <div className="w-full max-w-md rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-black">¿Cancelar el pedido #{pedido.numero}?</h2>
        <p className="mt-2 text-stone-600">
          Sale de la cocina al instante y no se puede deshacer. Si ya se cobró, la devolución se hace por fuera de Anotado.
        </p>
        <label className="mt-4 flex flex-col gap-1 font-medium">
          Motivo (opcional)
          <input
            value={motivo}
            maxLength={200}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="El cliente se arrepintió"
            className="rounded-xl border-2 border-stone-300 px-3 py-2 text-lg"
          />
        </label>
        {error && (
          <div className="mt-3">
            <MensajeError>{error}</MensajeError>
          </div>
        )}
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={onCerrar} className="flex-1 rounded-xl bg-stone-100 py-3 text-lg font-bold">
            Volver
          </button>
          <button
            type="button"
            disabled={enviando}
            onClick={() => void confirmar()}
            className="flex-1 rounded-xl bg-red-600 py-3 text-lg font-bold text-white active:bg-red-700 disabled:opacity-60"
          >
            {enviando ? 'Cancelando…' : 'Sí, cancelar'}
          </button>
        </div>
      </div>
    </div>
  );
}
