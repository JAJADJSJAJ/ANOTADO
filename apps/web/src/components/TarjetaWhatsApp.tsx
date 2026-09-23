import { agregarItem, type Borrador, type Pendientes } from '@anotado/shared';
import { type FormEvent, useState } from 'react';
import type { Producto } from '../hooks/useMenu.ts';
import {
  aEntregaBorrador,
  confirmarPedido,
  type DatosEntrega,
  desdeEntregaBorrador,
  type PedidoConfirmado,
} from '../lib/pedidos.ts';
import { supabase } from '../lib/supabase.ts';
import { MensajeError } from './Estado.tsx';
import { PanelPedido } from './PanelPedido.tsx';

/** Estado inicial de una tarjeta: nueva (sin conversación) o recuperada de la base. */
export type DatosTarjeta = {
  conversacionId: string | null;
  etiqueta: string;
  borrador: Borrador;
  pendientes: Pendientes;
};

type RespuestaParse = {
  conversacion_id: string;
  borrador: Borrador;
  pendientes: Pendientes;
};

/**
 * Una conversación de WhatsApp: el cajero pega los mensajes de UN cliente acá, la IA arma el
 * pedido, y el cajero resuelve lo dudoso y confirma. La IA nunca confirma sola.
 */
export function TarjetaWhatsApp({
  negocioId,
  inicial,
  productos,
  activos,
  onCerrada,
}: {
  negocioId: string;
  inicial: DatosTarjeta;
  productos: ReadonlyMap<string, Producto>;
  activos: Producto[];
  onCerrada: (confirmado: PedidoConfirmado | null, etiqueta: string) => void;
}) {
  const [conversacionId, setConversacionId] = useState(inicial.conversacionId);
  const [etiqueta, setEtiqueta] = useState(inicial.etiqueta);
  const [borrador, setBorrador] = useState<Borrador>(inicial.borrador);
  const [entrega, setEntrega] = useState<DatosEntrega>(desdeEntregaBorrador(inicial.borrador.entrega));
  const [pendientes, setPendientes] = useState<Pendientes>(inicial.pendientes);
  const [notas, setNotas] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [interpretando, setInterpretando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function interpretar(e: FormEvent) {
    e.preventDefault();
    if (!mensaje.trim()) return;
    setInterpretando(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke<RespuestaParse>('parse-order', {
      body: {
        negocio_id: negocioId,
        conversacion_id: conversacionId,
        mensaje,
        etiqueta: etiqueta.trim(),
        // Lo que se ve en pantalla (el cajero pudo haberlo editado): el servidor lo revalida.
        borrador: { ...borrador, entrega: aEntregaBorrador(entrega) },
        pendientes,
      },
    });
    setInterpretando(false);
    if (error || !data) {
      setError(await mensajeDeError(error));
      return;
    }
    setConversacionId(data.conversacion_id);
    setBorrador(data.borrador);
    setEntrega(desdeEntregaBorrador(data.borrador.entrega));
    setPendientes(data.pendientes);
    setMensaje('');
  }

  async function confirmar() {
    setConfirmando(true);
    setError(null);
    const r = await confirmarPedido({
      negocioId,
      origen: 'whatsapp',
      borrador,
      entrega,
      notas,
      conversacionId,
    });
    setConfirmando(false);
    if (!r.ok) return setError(r.error);
    onCerrada(r.pedido, etiqueta);
  }

  async function descartar() {
    if (!confirm(`¿Descartar ${etiqueta ? `el pedido de ${etiqueta}` : 'esta tarjeta'}? No se crea ningún pedido.`)) return;
    if (conversacionId) {
      const { error } = await supabase.rpc('cerrar_conversacion', { p_conversacion_id: conversacionId });
      if (error) return setError(error.message);
    }
    onCerrada(null, etiqueta);
  }

  const quitarPendiente = (tipo: keyof Pendientes, i: number) =>
    setPendientes((p) => ({ ...p, [tipo]: p[tipo].filter((_, j) => j !== i) }));

  return (
    <article className="flex flex-col gap-3 rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-3">
      <div className="flex items-center gap-2">
        <input
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          maxLength={40}
          placeholder="Nombre del cliente (opcional)"
          aria-label="Nombre de la tarjeta"
          className="min-w-0 flex-1 rounded-lg border-2 border-emerald-300 bg-white px-3 py-2 text-lg font-bold"
        />
        <button type="button" onClick={() => void descartar()} className="font-medium text-red-700 underline">
          Descartar
        </button>
      </div>

      <form onSubmit={interpretar} className="flex flex-col gap-2">
        <textarea
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Pegá acá el mensaje de WhatsApp del cliente"
          aria-label="Mensaje del cliente"
          className="rounded-lg border-2 border-neutral-300 bg-white px-3 py-2 text-lg"
        />
        <button
          type="submit"
          disabled={interpretando || !mensaje.trim()}
          className="rounded-xl bg-neutral-900 py-3 text-lg font-bold text-white disabled:opacity-50"
        >
          {interpretando ? 'Leyendo el mensaje…' : 'Interpretar mensaje'}
        </button>
      </form>

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

      {error && <MensajeError>{error}</MensajeError>}

      <PanelPedido
        titulo={etiqueta.trim() ? `Pedido de ${etiqueta.trim()}` : 'Pedido'}
        vacio="Pegá un mensaje y la IA arma el pedido. Revisalo antes de confirmar."
        borrador={borrador}
        onBorrador={setBorrador}
        productos={productos}
        entrega={entrega}
        onEntrega={setEntrega}
        notas={notas}
        onNotas={setNotas}
        onConfirmar={() => void confirmar()}
        enviando={confirmando}
        error={null}
      />
    </article>
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

function Aviso({ color, onCerrar, children }: { color: 'sky' | 'red'; onCerrar: () => void; children: React.ReactNode }) {
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

/** El error de invoke trae la respuesta HTTP: se usa el mensaje en español que manda la función. */
async function mensajeDeError(error: unknown): Promise<string> {
  const respuesta = (error as { context?: Response } | null)?.context;
  if (respuesta && typeof respuesta.json === 'function') {
    const cuerpo = (await respuesta.json().catch(() => null)) as { error?: string } | null;
    if (cuerpo?.error) return cuerpo.error;
  }
  return 'No se pudo interpretar el mensaje. Probá de nuevo o cargalo a mano.';
}

