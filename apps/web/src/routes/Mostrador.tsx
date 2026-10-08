import { agregarItem, type Borrador, borradorVacio, formatearPrecio, type Origen } from '@anotado/shared';
import { useMemo, useState } from 'react';
import { Agotados } from '../components/Agotados.tsx';
import { ListaAvisos } from '../components/Avisos.tsx';
import { Catalogo } from '../components/Catalogo.tsx';
import { Dialogo } from '../components/Dialogo.tsx';
import { Entregas } from '../components/Entregas.tsx';
import { Cargando, MensajeError, Nota } from '../components/Estado.tsx';
import { EstadoLocal } from '../components/EstadoLocal.tsx';
import { PanelPedido } from '../components/PanelPedido.tsx';
import { PedidosWhatsApp } from '../components/PedidosWhatsApp.tsx';
import { Segmentado } from '../components/Segmentado.tsx';
import { UltimosPedidos } from '../components/UltimosPedidos.tsx';
import { useAvisos } from '../hooks/useAvisos.ts';
import { useConversaciones } from '../hooks/useConversaciones.ts';
import { useMenu } from '../hooks/useMenu.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { usePedidosCocina } from '../hooks/usePedidosCocina.ts';
import { useZonas } from '../hooks/useZonas.ts';
import { confirmarPedido, type DatosEntrega, ENTREGA_RETIRO, type PedidoConfirmado } from '../lib/pedidos.ts';
import { efecto } from '../lib/sonido.ts';

export type Pestana = 'whatsapp' | 'manual' | 'entregas';

/**
 * El mostrador: los pedidos que llegan por WhatsApp, cargar uno a mano y lo que hay que
 * entregar. `compacto` = metido en una columna (la demo): menos márgenes.
 */
export function Mostrador({ pestanaInicial, compacto = false }: { pestanaInicial?: Pestana; compacto?: boolean }) {
  const negocio = useNegocio();
  const menu = useMenu(negocio.id);
  const productos = useMemo(() => new Map(menu.productos.map((p) => [p.id, p])), [menu.productos]);
  const activos = useMemo(() => menu.productos.filter((p) => p.activo), [menu.productos]);
  const { zonas } = useZonas(negocio.id);
  const zonasActivas = useMemo(() => zonas.filter((z) => z.activa), [zonas]);
  const { avisos, avisar, quitar } = useAvisos();

  // Con IA, lo normal es que los pedidos lleguen por WhatsApp; sin IA, se cargan a mano.
  const [pestana, setPestana] = useState<Pestana>(pestanaInicial ?? (negocio.iaPermitida ? 'whatsapp' : 'manual'));
  const [verAgotados, setVerAgotados] = useState(false);
  const [version, setVersion] = useState(0);
  // Pedidos en curso en tiempo real: alimentan la pestaña Entregas y su contador.
  const cocina = usePedidosCocina(negocio.id);
  const listos = cocina.pedidos?.filter((p) => p.estado === 'listo').length ?? 0;
  // Conversaciones de WhatsApp en tiempo real: alimentan la pestaña WhatsApp y su contador.
  const whatsapp = useConversaciones(negocio.id);
  const enCurso = whatsapp.conversaciones?.length ?? 0;

  // Carga manual.
  const [borrador, setBorrador] = useState<Borrador>(borradorVacio);
  const [origen, setOrigen] = useState<Origen>('mostrador');
  const [entrega, setEntrega] = useState<DatosEntrega>(ENTREGA_RETIRO);
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enPedido = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of borrador.items) m.set(it.producto_id, (m.get(it.producto_id) ?? 0) + it.cantidad);
    return m;
  }, [borrador]);

  function avisarConfirmado(pedido: PedidoConfirmado, etiqueta?: string) {
    efecto('imprimir');
    avisar({
      tipo: 'ok',
      texto: `Pedido #${pedido.numero}${etiqueta ? ` de ${etiqueta}` : ''} confirmado · ${formatearPrecio(pedido.total_centavos)}${
        pedido.envio_centavos > 0 ? ' con envío' : ''
      }`,
    });
    setVersion((v) => v + 1);
  }

  function cambiarOrigen(o: Origen) {
    setOrigen(o);
    // Un pedido tomado en la mesa casi siempre se sirve en la mesa.
    if (o === 'mesa') setEntrega((e) => ({ ...e, modo: 'mesa' }));
  }

  async function confirmarManual() {
    setError(null);
    setEnviando(true);
    const r = await confirmarPedido({ negocioId: negocio.id, origen, borrador, entrega, notas });
    setEnviando(false);
    if (!r.ok) {
      efecto('error');
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
  if (menu.error) {
    return (
      <div className="p-5">
        <MensajeError>{menu.error}</MensajeError>
      </div>
    );
  }

  const borde = compacto ? '' : 'px-3 sm:px-5';

  return (
    <main className={`@container flex min-h-0 flex-1 flex-col gap-4 ${compacto ? '' : 'py-4 sm:py-5'}`}>
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${borde}`}>
        <Segmentado
          pestanas
          etiqueta="Mostrador"
          valor={pestana}
          onCambio={setPestana}
          className="w-full @2xl:w-auto"
          opciones={[
            { valor: 'whatsapp', texto: <>WhatsApp{enCurso > 0 && <Contador n={enCurso} />}</> },
            { valor: 'manual', texto: 'Nuevo pedido' },
            { valor: 'entregas', texto: <>Entregas{listos > 0 && <Contador n={listos} />}</> },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <EstadoLocal horarios={negocio.horarios} zonaHoraria={negocio.zonaHoraria} />
          <button
            type="button"
            className="btn btn-chico"
            onClick={() => {
              void menu.recargar();
              setVerAgotados(true);
            }}
          >
            Agotados
          </button>
        </div>
      </div>

      {/* Las pestañas quedan montadas: cambiar de pestaña no pierde lo que se estaba armando. */}
      <div hidden={pestana !== 'whatsapp'} className={`flex min-h-0 flex-1 flex-col gap-3 ${borde}`}>
        {!(negocio.iaPermitida && negocio.iaActiva) && (
          <Nota tono="alerta">
            {negocio.iaPermitida
              ? 'La IA está apagada: los mensajes llegan, pero el pedido se arma a mano. El dueño la puede prender en Administrar.'
              : 'La IA no está habilitada para este local. Podés cargar los pedidos en "Nuevo pedido".'}
          </Nota>
        )}
        <PedidosWhatsApp
          negocioId={negocio.id}
          conversaciones={whatsapp.conversaciones}
          error={whatsapp.error}
          onRecargar={() => void whatsapp.recargar()}
          productos={productos}
          activos={activos}
          zonas={zonasActivas}
          onConfirmado={(pedido, etiqueta) => avisarConfirmado(pedido, etiqueta || undefined)}
        />
      </div>

      <div hidden={pestana !== 'manual'} className={`grid items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_22rem] ${borde}`}>
        <Catalogo
          categorias={menu.categorias}
          productos={menu.productos}
          enPedido={enPedido}
          onElegir={(p) => setBorrador((b) => agregarItem(b, p.id))}
        />
        <div className="tarjeta @4xl:sticky @4xl:top-[4.5rem] @4xl:max-h-[calc(100dvh-6rem)] @4xl:overflow-hidden">
          <PanelPedido
            titulo="Pedido nuevo"
            borrador={borrador}
            onBorrador={setBorrador}
            productos={productos}
            zonas={zonasActivas}
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

      <div hidden={pestana !== 'entregas'} className={`flex flex-col gap-6 ${borde}`}>
        <Entregas cocina={cocina} />
        <UltimosPedidos negocioId={negocio.id} version={version} />
      </div>

      {verAgotados && (
        <Dialogo
          titulo="Agotados"
          descripcion="Tocá lo que se terminó. Desde ese momento no se puede confirmar en ningún pedido."
          onCerrar={() => setVerAgotados(false)}
          ancho="max-w-3xl"
        >
          <div className="max-h-[60dvh] overflow-y-auto">
            <Agotados categorias={menu.categorias} productos={menu.productos} onCambio={() => void menu.recargar()} />
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn btn-tinta" onClick={() => setVerAgotados(false)}>
              Listo
            </button>
          </div>
        </Dialogo>
      )}
      <ListaAvisos avisos={avisos} onCerrar={quitar} />
    </main>
  );
}

function Contador({ n }: { n: number }) {
  return (
    <span key={n} className="contador animate-pop">
      {n}
    </span>
  );
}

