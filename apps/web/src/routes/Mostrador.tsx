import { agregarItem, type Borrador, borradorVacio, formatearPrecio, type Origen } from '@anotado/shared';
import { useMemo, useState } from 'react';
import { Catalogo } from '../components/Catalogo.tsx';
import { Entregas } from '../components/Entregas.tsx';
import { Cargando, MensajeError } from '../components/Estado.tsx';
import { PanelPedido } from '../components/PanelPedido.tsx';
import { PedidosWhatsApp } from '../components/PedidosWhatsApp.tsx';
import { UltimosPedidos } from '../components/UltimosPedidos.tsx';
import { useMenu } from '../hooks/useMenu.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { usePedidosCocina } from '../hooks/usePedidosCocina.ts';
import { confirmarPedido, type DatosEntrega, ENTREGA_RETIRO, type PedidoConfirmado } from '../lib/pedidos.ts';

type Pestana = 'manual' | 'whatsapp' | 'entregas';
type Confirmado = PedidoConfirmado & { etiqueta?: string };

export function Mostrador() {
  const negocio = useNegocio();
  const menu = useMenu(negocio.id);
  const productos = useMemo(() => new Map(menu.productos.map((p) => [p.id, p])), [menu.productos]);
  const activos = useMemo(() => menu.productos.filter((p) => p.activo), [menu.productos]);

  const [pestana, setPestana] = useState<Pestana>('manual');
  const [confirmado, setConfirmado] = useState<Confirmado | null>(null);
  const [version, setVersion] = useState(0);
  // Pedidos en curso en tiempo real: alimentan la pestaña Entregas y su contador.
  const cocina = usePedidosCocina(negocio.id);
  const listos = cocina.pedidos?.filter((p) => p.estado === 'listo').length ?? 0;

  // Carga manual.
  const [borrador, setBorrador] = useState<Borrador>(borradorVacio);
  const [origen, setOrigen] = useState<Origen>('mostrador');
  const [entrega, setEntrega] = useState<DatosEntrega>(ENTREGA_RETIRO);
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function avisarConfirmado(pedido: PedidoConfirmado, etiqueta?: string) {
    setConfirmado({ ...pedido, etiqueta });
    setVersion((v) => v + 1);
  }

  function cambiarOrigen(o: Origen) {
    setOrigen(o);
    // Un pedido tomado en la mesa casi siempre se sirve en la mesa.
    if (o === 'mesa') setEntrega((e) => ({ ...e, modo: 'mesa' }));
  }

  async function confirmarManual() {
    setError(null);
    setConfirmado(null);
    setEnviando(true);
    const r = await confirmarPedido({ negocioId: negocio.id, origen, borrador, entrega, notas });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      // Si un producto se agotó mientras se armaba, refrescar el menú.
      void menu.recargar();
      return;
    }
    avisarConfirmado(r.pedido);
    setBorrador(borradorVacio());
    setEntrega(ENTREGA_RETIRO);
    setOrigen('mostrador');
    setNotas('');
  }

  if (menu.cargando) return <Cargando />;
  if (menu.error) return <div className="p-4"><MensajeError>{menu.error}</MensajeError></div>;

  const pestanaClase = (p: Pestana) =>
    `flex-1 rounded-xl px-1 py-3 text-base font-bold shadow-sm sm:text-lg transition ${pestana === p ? 'bg-stone-900 text-white' : 'bg-white text-stone-700 hover:bg-stone-50'}`;

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <div role="tablist" className="flex gap-2">
        <button type="button" role="tab" aria-selected={pestana === 'manual'} className={pestanaClase('manual')} onClick={() => setPestana('manual')}>
          Carga manual
        </button>
        <button type="button" role="tab" aria-selected={pestana === 'whatsapp'} className={pestanaClase('whatsapp')} onClick={() => setPestana('whatsapp')}>
          WhatsApp
        </button>
        <button type="button" role="tab" aria-selected={pestana === 'entregas'} className={pestanaClase('entregas')} onClick={() => setPestana('entregas')}>
          Entregas
          {listos > 0 && (
            <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-sm text-white">{listos}</span>
          )}
        </button>
      </div>

      {confirmado && (
        <p role="status" className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4 text-xl font-bold text-emerald-900">
          Pedido #{confirmado.numero}
          {confirmado.etiqueta ? ` de ${confirmado.etiqueta}` : ''} confirmado · {formatearPrecio(confirmado.total_centavos)}
        </p>
      )}

      {/* Las dos pestañas quedan montadas: cambiar de pestaña no pierde lo que se estaba armando. */}
      <div hidden={pestana !== 'manual'} className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
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
            onConfirmar={() => void confirmarManual()}
            enviando={enviando}
            error={error}
          />
        </div>
      </div>

      <div hidden={pestana !== 'entregas'}>
        <Entregas cocina={cocina} />
      </div>

      <div hidden={pestana !== 'whatsapp'} className="flex flex-col gap-4">
        {!(negocio.iaPermitida && negocio.iaActiva) && (
          <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-lg font-medium text-amber-950">
            {negocio.iaPermitida
              ? 'La IA está apagada: los mensajes no se van a interpretar. El dueño la puede prender en Ajustes.'
              : 'La IA no está habilitada para este local. Podés cargar los pedidos en "Carga manual".'}
          </p>
        )}
        <PedidosWhatsApp
          negocioId={negocio.id}
          productos={productos}
          activos={activos}
          onConfirmado={(pedido, etiqueta) => avisarConfirmado(pedido, etiqueta || undefined)}
        />
      </div>
    </main>
  );
}
