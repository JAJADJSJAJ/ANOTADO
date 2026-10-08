import { agregarItem, type Borrador, borradorVacio, type Pendientes } from '@anotado/shared';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useAhora } from '../hooks/useAhora.ts';
import type { Conversacion, MensajeConversacion, TipoMensaje } from '../hooks/useConversaciones.ts';
import type { Producto } from '../hooks/useMenu.ts';
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
import { supabase } from '../lib/supabase.ts';
import { MensajeError } from './Estado.tsx';
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
    if (!r.ok) return setError(r.error);
    onCerrada(r.pedido, nombreCliente(clienteWhatsApp) ?? etiqueta);
  }

  async function descartar() {
    const quien = nombreCliente(clienteWhatsApp) ?? etiqueta;
    if (!confirm(`¿Descartar ${quien ? `el pedido de ${quien}` : 'esta tarjeta'}? No se crea ningún pedido.`)) return;
    if (conversacionId) {
      const { error } = await supabase.rpc('cerrar_conversacion', { p_conversacion_id: conversacionId });
      if (error) return setError(error.message);
    }
    onCerrada(null, quien);
  }

  const titulo = clienteWhatsApp ? nombreCliente(clienteWhatsApp) : etiqueta.trim();

  return (
    <article className="flex flex-col gap-3 rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-3">
      <div className="flex items-center gap-2">
        {clienteWhatsApp ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{nombreCliente(clienteWhatsApp) ?? 'Cliente'}</p>
            <p className="text-stone-600">{formatearTelefono(clienteWhatsApp.telefono)}</p>
          </div>
        ) : (
          <input
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            maxLength={40}
            placeholder="Nombre del cliente (opcional)"
            aria-label="Nombre de la tarjeta"
            className="min-w-0 flex-1 rounded-lg border-2 border-emerald-300 bg-white px-3 py-2 text-lg font-bold"
          />
        )}
        <button type="button" onClick={() => void descartar()} className="font-medium text-red-700 underline">
          Descartar
        </button>
      </div>

      {servidor && servidor.mensajes.length > 0 && <Mensajes mensajes={servidor.mensajes} />}

      {clienteWhatsApp ? (
        <EstadoIA
          servidor={servidor!}
          ocupado={interpretando}
          onInterpretar={() => void interpretarPendientes()}
        />
      ) : (
        <form onSubmit={interpretar} className="flex flex-col gap-2">
          <textarea
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Pegá acá el mensaje de WhatsApp del cliente"
            aria-label="Mensaje del cliente"
            className="rounded-lg border-2 border-stone-300 bg-white px-3 py-2 text-lg"
          />
          <button
            type="submit"
            disabled={interpretando || !mensaje.trim()}
            className="rounded-xl bg-stone-900 py-3 text-lg font-bold text-white disabled:opacity-50"
          >
            {interpretando ? 'Leyendo el mensaje…' : 'Interpretar mensaje'}
          </button>
        </form>
      )}

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
        <Aviso key={`${pregunta}-${i}`} color="sky" onCerrar={() => quitarPendiente('preguntas', i)}>
          <span className="font-bold">Preguntale al cliente:</span> {pregunta}
        </Aviso>
      ))}

      {pendientes.errores.map((texto, i) => (
        <Aviso key={`${texto}-${i}`} color="red" onCerrar={() => quitarPendiente('errores', i)}>
          <span className="font-bold">No se agregó:</span> {texto}
        </Aviso>
      ))}

      {aviso && (
        <Aviso color="sky" onCerrar={() => setAviso(null)}>
          {aviso}
        </Aviso>
      )}
      {error && <MensajeError>{error}</MensajeError>}

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
      />
    </article>
  );
}

const nombreCliente = (c: Conversacion['cliente']) => c?.nombre?.trim() || null;

/** +598 99 123 456 para los de Uruguay; el resto, con + y los dígitos. */
function formatearTelefono(t: string): string {
  const uy = /^598(9\d)(\d{3})(\d{3})$/.exec(t);
  return uy ? `+598 ${uy[1]} ${uy[2]} ${uy[3]}` : `+${t}`;
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

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });

/** La charla en orden: el cliente a la izquierda, el bot a la derecha. Lo que no es texto, en amarillo. */
function Mensajes({ mensajes }: { mensajes: MensajeConversacion[] }) {
  const final = useRef<HTMLLIElement>(null);
  useEffect(() => {
    final.current?.scrollIntoView({ block: 'nearest' });
  }, [mensajes.length]);
  return (
    <ol aria-label="Conversación con el cliente" className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-xl bg-white p-2">
      {mensajes.map((m, i) => {
        const avisoTipo = AVISOS_TIPO[m.tipo];
        const bot = m.rol === 'asistente';
        return (
          <li
            key={m.id}
            ref={i === mensajes.length - 1 ? final : undefined}
            className={`rounded-lg px-3 py-2 ${bot ? 'ml-8 bg-emerald-50' : avisoTipo ? 'mr-8 border-2 border-amber-300 bg-amber-50' : 'mr-8 bg-stone-100'}`}
          >
            {bot && <p className="text-xs font-bold text-emerald-800">Respuesta automática</p>}
            {avisoTipo && <p className="font-bold text-amber-900">{avisoTipo}</p>}
            {(!avisoTipo || m.contenido.includes(' ')) && <p className="whitespace-pre-wrap break-words">{m.contenido}</p>}
            {mapa(m) && (
              <a href={mapa(m)!} target="_blank" rel="noopener noreferrer" className="font-bold text-sky-800 underline">
                Ver en el mapa
              </a>
            )}
            <p className="text-right text-xs text-stone-500">{hora(m.created_at)}</p>
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
      <p role="status" className="rounded-xl bg-white p-3 text-lg font-medium text-stone-700">
        Leyendo los mensajes…
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
      <p className="flex-1 font-medium text-amber-950">
        {sinLeer.length === 1 ? 'Un mensaje sin interpretar.' : `${sinLeer.length} mensajes sin interpretar.`} Podés
        armar el pedido a mano o probar con la IA.
      </p>
      <button type="button" onClick={onInterpretar} className="rounded-xl bg-stone-900 px-4 py-2 font-bold text-white">
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
    <div className="flex flex-col gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3">
      <p>
        <span className="font-bold">Dudoso:</span> “{texto}”
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          aria-label="Producto correcto"
          className="min-w-0 flex-1 rounded-lg border-2 border-amber-300 bg-white px-2 py-2"
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
          className="w-16 rounded-lg border-2 border-amber-300 bg-white px-2 py-2 text-center"
        />
        <button
          type="button"
          disabled={!productoId}
          onClick={() => onElegir(productoId, cantidad)}
          className="rounded-lg bg-amber-500 px-3 py-2 font-bold text-white disabled:opacity-50"
        >
          Agregar
        </button>
        <button type="button" onClick={onDescartar} className="px-2 font-medium underline">
          Ignorar
        </button>
      </div>
    </div>
  );
}

function Aviso({ color, onCerrar, children }: { color: 'sky' | 'red'; onCerrar: () => void; children: ReactNode }) {
  const estilos = color === 'sky' ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-red-300 bg-red-50 text-red-900';
  return (
    <div className={`flex items-start gap-2 rounded-xl border-2 p-3 ${estilos}`}>
      <p className="flex-1">{children}</p>
      <button type="button" onClick={onCerrar} aria-label="Cerrar aviso" className="px-1 text-xl leading-none">
        ×
      </button>
    </div>
  );
}
