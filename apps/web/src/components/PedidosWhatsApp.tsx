import { useEffect, useRef, useState } from 'react';
import type { Conversacion } from '../hooks/useConversaciones.ts';
import type { Categoria, Producto } from '../hooks/useMenu.ts';
import type { Zona } from '../hooks/useZonas.ts';
import { useAhora } from '../hooks/useAhora.ts';
import type { PedidoConfirmado } from '../lib/pedidos.ts';
import { efecto } from '../lib/sonido.ts';
import { Cargando, MensajeError, Vacio } from './Estado.tsx';
import { Icono } from './Icono.tsx';
import { formatearTelefono, nombreCliente } from '../lib/whatsapp.ts';
import { TarjetaWhatsApp } from './TarjetaWhatsApp.tsx';

/** Tarjeta nueva de esta pantalla, todavía sin conversación en la lista del servidor. */
type Nueva = { clave: string; conversacionId: string | null };

let contador = 0;
const nuevaClave = () => `t${++contador}`;

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * Bandeja de WhatsApp: una conversación por cliente. Las abiertas vienen de la base y se
 * actualizan solas (useConversaciones): con WhatsApp conectado, aparecen cuando el cliente
 * escribe. "Pegar mensajes" abre una para pegar a mano. Todas quedan montadas (cada una
 * autoguarda lo que se edita); se ve una a la vez.
 */
export function PedidosWhatsApp({
  negocioId,
  conversaciones,
  error,
  onRecargar,
  productos,
  activos,
  categorias,
  zonas,
  onConfirmado,
}: {
  negocioId: string;
  conversaciones: Conversacion[] | null;
  error: string | null;
  onRecargar: () => void;
  productos: ReadonlyMap<string, Producto>;
  activos: Producto[];
  categorias: Categoria[];
  /** Zonas de envío activas. */
  zonas: Zona[];
  onConfirmado: (pedido: PedidoConfirmado, etiqueta: string) => void;
}) {
  const [nuevas, setNuevas] = useState<Nueva[]>([]);
  // Tarjetas cerradas desde esta pantalla: se ocultan ya, sin esperar la recarga.
  const [cerradas, setCerradas] = useState<ReadonlySet<string>>(new Set());
  const [elegida, setElegida] = useState<string | null>(null);

  // Cliente nuevo que escribe: suena (una vez por conversación, no al cargar la pantalla).
  const conocidas = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!conversaciones) return;
    const ids = conversaciones.map((c) => c.id);
    if (conocidas.current && ids.some((id) => !conocidas.current!.has(id))) efecto('recibir');
    conocidas.current = new Set(ids);
  }, [conversaciones]);

  if (error && !conversaciones) return <MensajeError>{error}</MensajeError>;
  if (!conversaciones) return <Cargando />;

  // Una tarjeta nueva, apenas su conversación aparece en la lista del servidor, se muestra
  // desde ahí (con sus mensajes y al día). Hasta entonces, la de esta pantalla.
  const enServidor = new Set(conversaciones.map((c) => c.id));
  const locales = nuevas.filter((n) => !n.conversacionId || !enServidor.has(n.conversacionId));
  const reclamadas = new Set(locales.map((n) => n.conversacionId));
  // Las que tienen al cliente esperando la confirmación van arriba, la que más espera primero.
  const visibles = conversaciones
    .filter((c) => !cerradas.has(c.id) && !reclamadas.has(c.id))
    .sort((a, b) => (a.listoAt ?? '9999').localeCompare(b.listoAt ?? '9999'));
  const cerrar = (id: string | null, clave?: string) => {
    if (id) setCerradas((s) => new Set(s).add(id));
    if (clave) setNuevas((ns) => ns.filter((n) => n.clave !== clave));
    onRecargar();
  };
  const props = { negocioId, productos, activos, categorias, zonas, onRecargar };

  // La que se ve: la elegida si sigue abierta; si no, la primera.
  const claves = [...visibles.map((c) => c.id), ...locales.map((n) => n.clave)];
  // Una pegada a mano que ya tiene id sigue elegida mientras llega a la lista del servidor.
  const claveDe = (k: string) => (claves.includes(k) ? k : locales.find((n) => n.conversacionId === k)?.clave);
  const actual = (elegida && claveDe(elegida)) || (claves[0] ?? null);

  function pegar() {
    const clave = nuevaClave();
    setNuevas((ns) => [...ns, { clave, conversacionId: null }]);
    setElegida(clave);
  }

  return (
    <section aria-label="Pedidos de WhatsApp" className="flex min-h-0 flex-1 flex-col gap-3 @3xl:flex-row @3xl:items-start">
      <aside className="flex shrink-0 flex-col gap-2 @3xl:sticky @3xl:top-[4.5rem] @3xl:w-64">
        <button type="button" onClick={pegar} className="btn w-full justify-start">
          <Icono nombre="mas" />
          Pegar mensajes de un cliente
        </button>
        {error && <MensajeError>{error}</MensajeError>}
        {claves.length > 0 && (
          <ul aria-label="Conversaciones" className="-mx-1 flex gap-1.5 overflow-x-auto sin-barra px-1 pb-1 @3xl:mx-0 @3xl:flex-col @3xl:overflow-visible @3xl:px-0">
            {visibles.map((c) => (
              <ItemBandeja key={c.id} conversacion={c} elegida={actual === c.id} onElegir={() => setElegida(c.id)} />
            ))}
            {locales.map((n) => (
              <ItemBandeja key={n.clave} conversacion={null} elegida={actual === n.clave} onElegir={() => setElegida(n.clave)} />
            ))}
          </ul>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        {claves.length === 0 && (
          <div className="tarjeta flex min-h-80">
            <Vacio icono="mensaje" titulo="No hay pedidos de WhatsApp en curso">
              Cuando un cliente escriba, aparece acá solo, con el pedido ya armado por la IA.
            </Vacio>
          </div>
        )}
        {visibles.map((c) => (
          <div key={c.id} hidden={actual !== c.id}>
            <TarjetaWhatsApp
              servidor={c}
              {...props}
              onCreada={() => {}}
              onCerrada={(pedido, etiqueta) => {
                cerrar(c.id);
                if (pedido) onConfirmado(pedido, etiqueta);
              }}
            />
          </div>
        ))}
        {locales.map((n) => (
          <div key={n.clave} hidden={actual !== n.clave}>
            <TarjetaWhatsApp
              servidor={null}
              {...props}
              onCreada={(id) => {
                setNuevas((ns) => ns.map((x) => (x.clave === n.clave ? { ...x, conversacionId: id } : x)));
                // Al aparecer en la lista del servidor, la tarjeta pasa a mostrarse con su id.
                setElegida(id);
                onRecargar();
              }}
              onCerrada={(pedido, etiqueta) => {
                cerrar(n.conversacionId, n.clave);
                if (pedido) onConfirmado(pedido, etiqueta);
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Una conversación en la bandeja: quién, lo último que dijo y en qué está. */
function ItemBandeja({
  conversacion: c,
  elegida,
  onElegir,
}: {
  conversacion: Conversacion | null;
  elegida: boolean;
  onElegir: () => void;
}) {
  const ultimo = c?.mensajes.at(-1);
  const titulo = c ? (nombreCliente(c.cliente) ?? (c.cliente ? formatearTelefono(c.cliente.telefono) : c.etiqueta || 'Pegado a mano')) : 'Pegado a mano';
  const pendientes = c ? c.pendientes.dudosos.length + c.pendientes.preguntas.length + c.pendientes.errores.length : 0;
  const ahora = useAhora(0, 30_000);
  const espera = c?.listoAt ? Math.max(0, Math.floor((ahora - new Date(c.listoAt).getTime()) / 60_000)) : null;
  const estado = !c
    ? { texto: 'Nuevo', clase: '' }
    : espera !== null
      ? { texto: espera < 1 ? 'Espera confirmar' : `Espera hace ${espera} min`, clase: espera >= 5 ? 'chip-peligro' : 'chip-alerta' }
      : c.interpretando
      ? { texto: 'Leyendo', clase: 'chip-birome' }
      : pendientes > 0
        ? { texto: 'Revisar', clase: 'chip-alerta' }
        : c.borrador.items.length > 0
          ? { texto: 'Armado', clase: 'chip-ok' }
          : null;

  return (
    <li className="shrink-0 animate-entra @3xl:shrink">
      <button
        type="button"
        aria-current={elegida}
        data-sonido="llave"
        onClick={onElegir}
        className={`flex w-60 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 @3xl:w-full ${
          elegida ? 'border-tinta bg-hoja shadow-papel' : 'border-transparent hover:border-linea hover:bg-hoja/60'
        }`}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{titulo}</span>
          {ultimo && <span className="num shrink-0 text-xs text-tinta-3">{hora(ultimo.created_at)}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-tinta-2">
            {ultimo ? `${ultimo.rol === 'asistente' ? 'Bot: ' : ''}${ultimo.contenido}` : 'Sin mensajes todavía'}
          </span>
          {estado && (
            <span className={`chip chip-punto ${estado.clase} ${c?.interpretando ? 'before:animate-latido' : ''}`}>{estado.texto}</span>
          )}
        </span>
      </button>
    </li>
  );
}
