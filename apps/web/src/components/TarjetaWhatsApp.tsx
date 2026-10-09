import { agregarItem, type Borrador, borradorVacio, type Pendientes } from '@anotado/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAhora } from '../hooks/useAhora.ts';
import type { Conversacion, MensajeConversacion, TipoMensaje } from '../hooks/useConversaciones.ts';
import type { Categoria, Producto } from '../hooks/useMenu.ts';
import type { Zona } from '../hooks/useZonas.ts';
import { mensajeDeFuncion } from '../lib/funciones.ts';
import {
  aEntregaBorrador,
  confirmarConversacion,
  confirmarPedido,
  type DatosEntrega,
  desdeEntregaBorrador,
  type PedidoConfirmado,
} from '../lib/pedidos.ts';
import { usePreguntar } from '../lib/dialogos.ts';
import { formatearTelefono, nombreCliente } from '../lib/whatsapp.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { MensajeError, Nota } from './Estado.tsx';
import { Icono } from './Icono.tsx';
import { PanelPedido } from './PanelPedido.tsx';

/** Lo que edita el cajero se guarda solo, al rato de dejar de tocar. */
const ESPERA_AUTOGUARDADO_MS = 800;
/** Un mensaje recién llegado se muestra como "leyendo" este tiempo antes de ofrecer el botón. */
const ESPERA_IA_MS = 20_000;

type RespuestaParse = {
  conversacion_id: string;
  version: number;
  borrador: Borrador;
  pendientes: Pendientes;
};

const SIN_PENDIENTES: Pendientes = { dudosos: [], preguntas: [], errores: [] };

/**
 * Una conversación de WhatsApp. Con WhatsApp conectado, los mensajes llegan solos y la IA arma
 * el pedido; sin WhatsApp, el cajero pega los mensajes de UN cliente. En los dos casos el
 * cajero revisa, resuelve lo dudoso y confirma: la IA nunca confirma sola.
 *
 * Lo que edita el cajero se guarda solo en la base (guardar_borrador, con versión). Si la IA
 * interpretó un mensaje nuevo mientras tanto, la base lo rechaza y la tarjeta se actualiza con
 * lo último: así la IA siempre trabaja sobre lo que el cajero ya corrigió.
 */
export function TarjetaWhatsApp({
  negocioId,
  servidor,
  productos,
  activos,
  categorias,
  zonas,
  onCreada,
  onCerrada,
  onRecargar,
}: {
  negocioId: string;
  /** La conversación en la base; null = tarjeta nueva, todavía sin mensajes. */
  servidor: Conversacion | null;
  productos: ReadonlyMap<string, Producto>;
  activos: Producto[];
  categorias: Categoria[];
  zonas: Zona[];
  onCreada: (conversacionId: string) => void;
  onCerrada: (confirmado: PedidoConfirmado | null, etiqueta: string) => void;
  onRecargar: () => void;
}) {
  const [conversacionId, setConversacionId] = useState(servidor?.id ?? null);
  const [version, setVersion] = useState(servidor?.version ?? null);
  const [etiqueta, setEtiqueta] = useState(servidor?.etiqueta ?? '');
  const [borrador, setBorrador] = useState<Borrador>(servidor?.borrador ?? borradorVacio());
  const [entrega, setEntrega] = useState<DatosEntrega>(desdeEntregaBorrador(servidor?.borrador.entrega ?? null));
  const [pendientes, setPendientes] = useState<Pendientes>(servidor?.pendientes ?? SIN_PENDIENTES);
  const [notas, setNotas] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [interpretando, setInterpretando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Autoguardado. `sucio` = hay cambios sin guardar; mientras tanto no se pisa con lo del servidor.
  const [sucio, setSucio] = useState(false);
  const [enVuelo, setEnVuelo] = useState(false);
  const guardando = useRef<Promise<number | null> | null>(null);
  const edicion = useRef(0);
  /** Última edición que quedó guardada (igual a edicion = no hay nada sin guardar). */
  const guardada = useRef(0);

  const clienteWhatsApp = servidor?.cliente ?? null;
  const preguntar = usePreguntar();

  // Sonidos: llega un mensaje del cliente, la IA anota algo en el pedido.
  const ultimoCliente = servidor?.mensajes.filter((m) => m.rol === 'cliente').at(-1)?.id;
  const vistoCliente = useRef(ultimoCliente);
  useEffect(() => {
    if (ultimoCliente && ultimoCliente !== vistoCliente.current) efecto('recibir');
    vistoCliente.current = ultimoCliente;
  }, [ultimoCliente]);
  const items = borrador.items.length;
  const itemsAntes = useRef(items);
  useEffect(() => {
    if (items > itemsAntes.current && !sucio) efecto('anotar');
    itemsAntes.current = items;
  }, [items, sucio]);


  // Lo nuevo del servidor (la IA interpretó, otra pantalla editó) se adopta si no hay cambios
  // locales sin guardar. Durante el render, con guarda (no en un efecto): al adoptar, la
  // versión queda igual y no se repite. La zona y las notas son de esta pantalla y no se pisan.
  if (servidor && !sucio && !enVuelo && (version === null || servidor.version > version)) {
    setVersion(servidor.version);
    setBorrador(servidor.borrador);
    setPendientes(servidor.pendientes);
    setEntrega(desdeEntregaBorrador(servidor.borrador.entrega, entrega.zonaId));
  }

  /** Guarda lo que se ve, partiendo de la versión `desde`. Devuelve la versión nueva o null. */
  const guardar = useCallback(
    async (desde: number | null): Promise<number | null> => {
      if (!conversacionId || desde === null) return desde;
      const esta = edicion.current;
      const { data, error } = await supabase.rpc('guardar_borrador', {
        p_conversacion_id: conversacionId,
        p_version: desde,
        p_borrador: { ...borrador, entrega: aEntregaBorrador(entrega) },
        p_pendientes: pendientes,
      });
      if (error) {
        guardada.current = edicion.current;
        setSucio(false);
        if (error.code === '40001') {
          // Llegó algo nuevo (la IA o otra pantalla): se adopta lo del servidor.
          setAviso('La tarjeta se actualizó con lo último. Revisá tu último cambio.');
          setVersion(null);
          onRecargar();
        } else {
          setError(error.message);
        }
        return null;
      }
      setVersion(data);
      guardada.current = esta;
      // Si se editó de nuevo mientras guardaba, queda sucio y se vuelve a guardar.
      if (edicion.current === esta) setSucio(false);
      return data;
    },
    [conversacionId, borrador, entrega, pendientes, onRecargar],
  );

  /** Un guardado a la vez: se marca en vuelo y quien llega mientras tanto lo espera. */
  const lanzarGuardado = useCallback(
    (desde: number | null) => {
      setEnVuelo(true);
      const p = guardar(desde).finally(() => {
        guardando.current = null;
        setEnVuelo(false);
      });
      guardando.current = p;
      return p;
    },
    [guardar],
  );

  useEffect(() => {
    if (!sucio || !conversacionId || enVuelo) return;
    const t = setTimeout(() => void lanzarGuardado(version), ESPERA_AUTOGUARDADO_MS);
    return () => clearTimeout(t);
  }, [sucio, conversacionId, enVuelo, version, lanzarGuardado]);

  /** Guarda ya lo pendiente (antes de interpretar o confirmar). Devuelve la versión o null. */
  async function guardarAhora(): Promise<number | null> {
    let desde = version;
    if (guardando.current) {
      // El que estaba en vuelo puede no incluir la última edición: se sigue desde su versión.
      desde = await guardando.current;
      if (desde === null) return null;
    }
    if (guardada.current === edicion.current) return desde;
    return lanzarGuardado(desde);
  }

  const marcar = () => {
    edicion.current++;
    setSucio(true);
    setAviso(null);
  };
  const editarBorrador = (b: Borrador) => {
    setBorrador(b);
    marcar();
  };
  const editarEntrega = (e: DatosEntrega) => {
    const cambioBorrador = JSON.stringify(aEntregaBorrador(e)) !== JSON.stringify(aEntregaBorrador(entrega));
    setEntrega(e);
    // La zona no va al borrador: elegirla no hace falta guardarla.
    if (cambioBorrador) marcar();
  };
  const quitarPendiente = (tipo: keyof Pendientes, i: number) => {
    setPendientes((p) => ({ ...p, [tipo]: p[tipo].filter((_, j) => j !== i) }));
    marcar();
  };

  async function interpretar(e: FormEvent) {
    e.preventDefault();
    if (!mensaje.trim()) return;
    setInterpretando(true);
    setError(null);
    const v = conversacionId ? await guardarAhora() : null;
    if (conversacionId && v === null) return setInterpretando(false);
    const { data, error } = await supabase.functions.invoke<RespuestaParse>('parse-order', {
      body: {
        negocio_id: negocioId,
        conversacion_id: conversacionId,
        ...(v !== null && { version: v }),
        mensaje,
        etiqueta: etiqueta.trim(),
        // Lo que se ve en pantalla (el cajero pudo haberlo editado): el servidor lo revalida.
        borrador: { ...borrador, entrega: aEntregaBorrador(entrega) },
        pendientes,
      },
    });
    setInterpretando(false);
    if (error || !data) {
      setError(await mensajeDeFuncion(error, 'No se pudo interpretar el mensaje. Probá de nuevo o cargalo a mano.'));
      return;
    }
    if (!conversacionId) onCreada(data.conversacion_id);
    setConversacionId(data.conversacion_id);
    setVersion(data.version);
    setBorrador(data.borrador);
    setEntrega((e) => desdeEntregaBorrador(data.borrador.entrega, e.zonaId));
    setPendientes(data.pendientes);
    setMensaje('');
  }

  /** WhatsApp conectado: interpretar lo que quedó sin interpretar (IA apagada o falló). */
  async function interpretarPendientes() {
    if (!conversacionId) return;
    setInterpretando(true);
    setError(null);
    if ((await guardarAhora()) === null) return setInterpretando(false);
    const { error } = await supabase.functions.invoke('parse-order', {
      body: { negocio_id: negocioId, conversacion_id: conversacionId, interpretar_pendientes: true },
    });
    setInterpretando(false);
    if (error) setError(await mensajeDeFuncion(error, 'No se pudo interpretar. Probá de nuevo o cargalo a mano.'));
    onRecargar();
  }

  async function confirmar() {
    setConfirmando(true);
    setError(null);
    let r;
    if (conversacionId) {
      const v = await guardarAhora();
      if (v === null || !servidor) {
        setConfirmando(false);
        if (!servidor) setError('Todavía se está sincronizando la tarjeta. Probá en un segundo.');
        return;
      }
      r = await confirmarConversacion({
        negocioId,
        conversacionId,
        version: v,
        ultimoMensaje: servidor.mensajes.at(-1)?.id ?? null,
        borrador,
        entrega,
        notas,
      });
      if (!r.ok && r.cambio) {
        setVersion(null);
        onRecargar();
      }
    } else {
      r = await confirmarPedido({ negocioId, origen: 'whatsapp', borrador, entrega, notas });
    }
    setConfirmando(false);
    if (!r.ok) {
      efecto('error');
      return setError(r.error);
    }
    onCerrada(r.pedido, nombreCliente(clienteWhatsApp) ?? etiqueta);
  }

  async function descartar() {
    const quien = nombreCliente(clienteWhatsApp) ?? etiqueta;
    const ok = await preguntar({
      titulo: `¿Descartar ${quien ? `el pedido de ${quien}` : 'esta conversación'}?`,
      texto: 'No se crea ningún pedido. Si el cliente vuelve a escribir, aparece de nuevo.',
      aceptar: 'Descartar',
      peligro: true,
    });
    if (ok === null) return;
    if (conversacionId) {
      const { error } = await supabase.rpc('cerrar_conversacion', { p_conversacion_id: conversacionId });
      if (error) return setError(error.message);
    }
    onCerrada(null, quien);
  }

  const titulo = clienteWhatsApp ? nombreCliente(clienteWhatsApp) : etiqueta.trim();
  const hayPendientes = pendientes.dudosos.length + pendientes.preguntas.length + pendientes.errores.length > 0 || aviso || error;

  return (
    <article className="tarjeta @container/t animate-entra overflow-hidden">
      <header className="flex items-center gap-3 border-b border-linea px-4 py-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-wa text-sm font-bold text-white">
          {(titulo || 'C').charAt(0).toUpperCase()}
        </span>
        {clienteWhatsApp ? (
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{nombreCliente(clienteWhatsApp) ?? 'Cliente'}</p>
            <p className="num truncate text-[0.8125rem] text-tinta-3">{formatearTelefono(clienteWhatsApp.telefono)}</p>
          </div>
        ) : (
          <input
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            maxLength={40}
            placeholder="Nombre del cliente (opcional)"
            aria-label="Nombre de la tarjeta"
            className="campo campo-chico min-w-0 flex-1 font-semibold"
          />
        )}
        <button type="button" onClick={() => void descartar()} className="btn btn-quitar btn-chico">
          Descartar
        </button>
      </header>

      <div className="grid @2xl/t:grid-cols-2">
        <section aria-label="Conversación" className="flex min-h-0 flex-col border-b border-linea @2xl/t:border-r @2xl/t:border-b-0">
          {servidor && servidor.mensajes.length > 0 ? (
            <Mensajes mensajes={servidor.mensajes} />
          ) : (
            !clienteWhatsApp && (
              <p className="px-4 pt-4 text-sm text-tinta-2">
                Copiá los mensajes del cliente en WhatsApp y pegalos acá. La IA arma el pedido; vos lo revisás.
              </p>
            )
          )}
          {clienteWhatsApp ? (
            <EstadoIA servidor={servidor!} ocupado={interpretando} onInterpretar={() => void interpretarPendientes()} />
          ) : (
            <form onSubmit={interpretar} className="flex flex-col gap-2 p-4">
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Pegá acá el mensaje de WhatsApp del cliente"
                aria-label="Mensaje del cliente"
                className="campo"
              />
              <button type="submit" disabled={interpretando || !mensaje.trim()} className="btn btn-tinta">
                {interpretando ? 'Leyendo el mensaje…' : 'Interpretar mensaje'}
              </button>
            </form>
          )}
        </section>

        <PanelPedido
          titulo={titulo ? `Pedido de ${titulo}` : 'Pedido'}
          vacio={
            clienteWhatsApp
              ? 'Cuando la IA lea los mensajes, el pedido aparece acá. También podés armarlo a mano.'
              : 'Pegá un mensaje y la IA arma el pedido. Revisalo antes de confirmar.'
          }
          borrador={borrador}
          onBorrador={editarBorrador}
          productos={productos}
          zonas={zonas}
          entrega={entrega}
          onEntrega={editarEntrega}
          notas={notas}
          onNotas={setNotas}
          onConfirmar={() => void confirmar()}
          enviando={confirmando}
          error={null}
          agregar={{ categorias, onAgregar: (prod) => editarBorrador(agregarItem(borrador, prod.id)) }}
          extra={
            hayPendientes && (
              <div className="flex flex-col gap-2">
                {pendientes.dudosos.map((texto, i) => (
                  <Dudoso
                    key={`${texto}-${i}`}
                    texto={texto}
                    activos={activos}
                    onElegir={(productoId, cantidad) => {
                      setBorrador((b) => agregarItem(b, productoId, cantidad));
                      quitarPendiente('dudosos', i);
                    }}
                    onDescartar={() => quitarPendiente('dudosos', i)}
                  />
                ))}
                {pendientes.preguntas.map((pregunta, i) => (
                  <Nota
                    key={`${pregunta}-${i}`}
                    tono="alerta"
                    accion={<Cerrar onClick={() => quitarPendiente('preguntas', i)} />}
                  >
                    <span className="font-semibold">Falta saber:</span> {pregunta}
                  </Nota>
                ))}
                {pendientes.errores.map((texto, i) => (
                  <Nota key={`${texto}-${i}`} tono="peligro" accion={<Cerrar onClick={() => quitarPendiente('errores', i)} />}>
                    <span className="font-semibold">No se agregó:</span> {texto}
                  </Nota>
                ))}
                {aviso && (
                  <Nota accion={<Cerrar onClick={() => setAviso(null)} />}>{aviso}</Nota>
                )}
                {error && <MensajeError>{error}</MensajeError>}
              </div>
            )
          }
        />
      </div>
    </article>
  );
}

function Cerrar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Listo, cerrar aviso" title="Cerrar" className="-my-1 -mr-1.5 grid size-7 place-items-center rounded-md text-tinta-3 transition-colors hover:bg-tinta/5 hover:text-tinta">
      <Icono nombre="cerrar" className="size-4" />
    </button>
  );
}

const AVISOS_TIPO: Partial<Record<TipoMensaje, string>> = {
  audio: 'Mandó un audio. Todavía no se puede escuchar desde Anotado.',
  imagen: 'Mandó una foto. Todavía no se puede ver desde Anotado.',
  video: 'Mandó un video. Todavía no se puede ver desde Anotado.',
  documento: 'Mandó un archivo. Todavía no se puede abrir desde Anotado.',
  sticker: 'Mandó un sticker.',
  contacto: 'Mandó un contacto.',
  otro: 'Mandó algo que Anotado no puede mostrar.',
};

/** Link al mapa de una ubicación: solo el que arma el servidor con las coordenadas. */
const mapa = (m: MensajeConversacion) =>
  m.tipo === 'ubicacion' ? (/https:\/\/maps\.google\.com\/\?q=-?\d+\.\d+,-?\d+\.\d+/.exec(m.contenido)?.[0] ?? null) : null;

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** La charla en orden, como un registro: hora, quién y qué. Lo que no es texto, marcado. */
function Mensajes({ mensajes }: { mensajes: MensajeConversacion[] }) {
  const caja = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = caja.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [mensajes.length]);
  return (
    <ol
      ref={caja}
      aria-label="Conversación con el cliente"
      className="flex max-h-[26rem] min-h-40 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5 @2xl/t:max-h-[34rem]"
    >
      {mensajes.map((m) => {
        const avisoTipo = AVISOS_TIPO[m.tipo];
        const bot = m.rol === 'asistente';
        return (
          <li key={m.id} className="grid animate-entra grid-cols-[2.75rem_minmax(0,1fr)] gap-2 text-[0.9375rem] leading-snug">
            <time className="num pt-0.5 text-xs text-tinta-3">{hora(m.created_at)}</time>
            <div className="min-w-0">
              {bot && <span className="rotulo mr-2 text-ok">Bot</span>}
              {avisoTipo && <span className="chip chip-alerta mb-1">{avisoTipo}</span>}
              {(!avisoTipo || m.contenido.includes(' ')) && (
                <span className={`break-words whitespace-pre-wrap ${bot ? 'text-tinta-2' : ''}`}>{m.contenido}</span>
              )}
              {mapa(m) && (
                <a href={mapa(m)!} target="_blank" rel="noopener noreferrer" className="enlace mt-1 flex items-center gap-1 text-sm">
                  <Icono nombre="ubicacion" className="size-4" />
                  Ver en el mapa
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Si la IA está leyendo, o si quedaron mensajes sin interpretar (IA apagada, límite, falla). */
function EstadoIA({ servidor, ocupado, onInterpretar }: { servidor: Conversacion; ocupado: boolean; onInterpretar: () => void }) {
  const ahora = useAhora(0, 5_000);
  const sinLeer = servidor.mensajes.filter((m) => m.tipo === 'texto' && !m.interpretado);
  if (sinLeer.length === 0) return null;
  const ultimo = new Date(sinLeer.at(-1)!.created_at).getTime();
  if (ocupado || servidor.interpretando || ahora - ultimo < ESPERA_IA_MS) {
    return (
      <p role="status" className="flex items-center gap-2.5 border-t border-linea px-4 py-3 text-sm font-medium text-birome">
        <span aria-hidden className="flex gap-1">
          {[0, 150, 300].map((d) => (
            <span key={d} className="size-1.5 animate-latido rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
          ))}
        </span>
        La IA está leyendo los mensajes
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-linea bg-alerta-suave/50 px-4 py-3">
      <p className="flex-1 text-sm">
        {sinLeer.length === 1 ? 'Un mensaje sin interpretar.' : `${sinLeer.length} mensajes sin interpretar.`} Armá el pedido a
        mano o probá con la IA.
      </p>
      <button type="button" onClick={onInterpretar} className="btn btn-tinta btn-chico">
        Interpretar
      </button>
    </div>
  );
}

/** Algo que la IA no supo asociar a un producto: el cajero elige o descarta. */
function Dudoso({
  texto,
  activos,
  onElegir,
  onDescartar,
}: {
  texto: string;
  activos: Producto[];
  onElegir: (productoId: string, cantidad: number) => void;
  onDescartar: () => void;
}) {
  const [productoId, setProductoId] = useState('');
  const [cantidad, setCantidad] = useState(1);
  return (
    <div className="flex animate-entra flex-col gap-2.5 rounded-xl border border-alerta/30 bg-alerta-suave px-3.5 py-3">
      <p className="flex items-start gap-3 text-[0.9375rem] leading-snug">
        <Icono nombre="alerta" className="mt-px text-alerta" />
        <span>
          <span className="font-semibold">No sé qué es:</span> “{texto}”
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          aria-label="Producto correcto"
          className="campo campo-chico min-w-0 flex-1"
        >
          <option value="">Elegí el producto…</option>
          {activos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={20}
          value={cantidad}
          onChange={(e) => setCantidad(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          aria-label="Cantidad"
          className="campo campo-chico num w-16 text-center"
        />
        <button type="button" disabled={!productoId} onClick={() => onElegir(productoId, cantidad)} className="btn btn-tinta btn-chico h-9">
          Agregar
        </button>
        <button type="button" onClick={onDescartar} className="btn btn-fantasma btn-chico h-9">
          Ignorar
        </button>
      </div>
    </div>
  );
}
