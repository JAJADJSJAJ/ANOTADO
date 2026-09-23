import {
  agregarItem,
  type Borrador,
  borradorVacio,
  ConfirmarPedidoSchema,
  type Entrega,
  formatearPrecio,
  type Origen,
} from '@anotado/shared';
import { useMemo, useState } from 'react';
import { Catalogo } from '../components/Catalogo.tsx';
import { Cargando, MensajeError } from '../components/Estado.tsx';
import { type DatosEntrega, PanelPedido } from '../components/PanelPedido.tsx';
import { UltimosPedidos } from '../components/UltimosPedidos.tsx';
import { useMenu } from '../hooks/useMenu.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { supabase } from '../lib/supabase.ts';

const ENTREGA_INICIAL: DatosEntrega = { modo: 'retiro', direccion: '', mesa: '' };

type Confirmado = { numero: number; total_centavos: number };

export function Mostrador() {
  const negocio = useNegocio();
  const menu = useMenu(negocio.id);
  const productos = useMemo(() => new Map(menu.productos.map((p) => [p.id, p])), [menu.productos]);

  const [borrador, setBorrador] = useState<Borrador>(borradorVacio);
  const [origen, setOrigen] = useState<Origen>('mostrador');
  const [entrega, setEntrega] = useState<DatosEntrega>(ENTREGA_INICIAL);
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState<Confirmado | null>(null);
  const [version, setVersion] = useState(0);

  function cambiarOrigen(o: Origen) {
    setOrigen(o);
    // Un pedido tomado en la mesa casi siempre se sirve en la mesa.
    if (o === 'mesa') setEntrega((e) => ({ ...e, modo: 'mesa' }));
  }

  async function confirmar() {
    setError(null);
    setConfirmado(null);

    if (entrega.modo === 'delivery' && !entrega.direccion.trim()) return setError('Escribí la dirección del delivery.');
    if (entrega.modo === 'mesa' && !entrega.mesa.trim()) return setError('Escribí el número de mesa.');

    const datosEntrega: Entrega =
      entrega.modo === 'delivery'
        ? { modo: 'delivery', direccion: entrega.direccion }
        : entrega.modo === 'mesa'
          ? { modo: 'mesa', mesa: entrega.mesa }
          : { modo: 'retiro' };

    const pedido = ConfirmarPedidoSchema.safeParse({
      origen,
      items: borrador.items,
      entrega: datosEntrega,
      notas: notas.trim() || undefined,
    });
    if (!pedido.success) return setError('Revisá el pedido: hay datos inválidos.');

    setEnviando(true);
    // Sin precios: el servidor los toma de la base y calcula el total.
    const { data, error } = await supabase.rpc('confirmar_pedido', {
      p_negocio_id: negocio.id,
      p_origen: pedido.data.origen,
      p_items: pedido.data.items,
      p_entrega: pedido.data.entrega,
      p_notas: pedido.data.notas,
    });
    setEnviando(false);

    if (error) {
      setError(error.message);
      // Si un producto se agotó mientras se armaba, refrescar el menú.
      void menu.recargar();
      return;
    }
    setConfirmado(data as Confirmado);
    setBorrador(borradorVacio());
    setEntrega(ENTREGA_INICIAL);
    setOrigen('mostrador');
    setNotas('');
    setVersion((v) => v + 1);
  }

  if (menu.cargando) return <Cargando />;
  if (menu.error) return <div className="p-4"><MensajeError>{menu.error}</MensajeError></div>;

  return (
    <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[1fr_24rem]">
      <div className="flex flex-col gap-4">
        {confirmado && (
          <p role="status" className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4 text-xl font-bold text-emerald-900">
            Pedido #{confirmado.numero} confirmado · {formatearPrecio(confirmado.total_centavos)}
          </p>
        )}
        <Catalogo
          categorias={menu.categorias}
          productos={menu.productos}
          onElegir={(p) => {
            setConfirmado(null);
            setBorrador((b) => agregarItem(b, p.id));
          }}
        />
        <UltimosPedidos negocioId={negocio.id} version={version} />
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <PanelPedido
          borrador={borrador}
          onBorrador={setBorrador}
          productos={productos}
          origen={origen}
          onOrigen={cambiarOrigen}
          entrega={entrega}
          onEntrega={setEntrega}
          notas={notas}
          onNotas={setNotas}
          onConfirmar={() => void confirmar()}
          enviando={enviando}
          error={error}
        />
      </div>
    </main>
  );
}
