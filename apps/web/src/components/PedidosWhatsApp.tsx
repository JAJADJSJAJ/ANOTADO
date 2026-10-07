import { useState } from 'react';
import type { Conversacion } from '../hooks/useConversaciones.ts';
import type { Producto } from '../hooks/useMenu.ts';
import type { Zona } from '../hooks/useZonas.ts';
import type { PedidoConfirmado } from '../lib/pedidos.ts';
import { Cargando, MensajeError } from './Estado.tsx';
import { TarjetaWhatsApp } from './TarjetaWhatsApp.tsx';

/** Tarjeta nueva de esta pantalla, todavía sin conversación en la lista del servidor. */
type Nueva = { clave: string; conversacionId: string | null };

let contador = 0;
const nuevaClave = () => `t${++contador}`;

/**
 * Tarjetas de WhatsApp: una por cliente. Las conversaciones abiertas vienen de la base y se
 * actualizan solas (useConversaciones): con WhatsApp conectado, aparecen cuando el cliente
 * escribe. "Nuevo pedido de WhatsApp" abre una tarjeta para pegar mensajes a mano.
 */
export function PedidosWhatsApp({
  negocioId,
  conversaciones,
  error,
  onRecargar,
  productos,
  activos,
  zonas,
  onConfirmado,
}: {
  negocioId: string;
  conversaciones: Conversacion[] | null;
  error: string | null;
  onRecargar: () => void;
  productos: ReadonlyMap<string, Producto>;
  activos: Producto[];
  /** Zonas de envío activas. */
  zonas: Zona[];
  onConfirmado: (pedido: PedidoConfirmado, etiqueta: string) => void;
}) {
  const [nuevas, setNuevas] = useState<Nueva[]>([]);
  // Tarjetas cerradas desde esta pantalla: se ocultan ya, sin esperar la recarga.
  const [cerradas, setCerradas] = useState<ReadonlySet<string>>(new Set());

  if (error && !conversaciones) return <MensajeError>{error}</MensajeError>;
  if (!conversaciones) return <Cargando />;

  // Una tarjeta nueva, apenas su conversación aparece en la lista del servidor, se muestra
  // desde ahí (con sus mensajes y al día). Hasta entonces, la de esta pantalla.
  const enServidor = new Set(conversaciones.map((c) => c.id));
  const locales = nuevas.filter((n) => !n.conversacionId || !enServidor.has(n.conversacionId));
  const reclamadas = new Set(locales.map((n) => n.conversacionId));
  const visibles = conversaciones.filter((c) => !cerradas.has(c.id) && !reclamadas.has(c.id));
  const cerrar = (id: string | null, clave?: string) => {
    if (id) setCerradas((s) => new Set(s).add(id));
    if (clave) setNuevas((ns) => ns.filter((n) => n.clave !== clave));
    onRecargar();
  };
  const props = { negocioId, productos, activos, zonas, onRecargar };

  return (
    <section aria-label="Pedidos de WhatsApp" className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setNuevas((ns) => [...ns, { clave: nuevaClave(), conversacionId: null }])}
        className="self-start rounded-xl bg-emerald-600 px-5 py-4 text-lg font-bold text-white active:bg-emerald-700"
      >
        + Pegar mensajes de un cliente
      </button>

      {error && <MensajeError>{error}</MensajeError>}

      {visibles.length === 0 && locales.length === 0 && (
        <p className="text-lg text-stone-600">
          No hay pedidos de WhatsApp en curso. Cuando un cliente escriba, aparece acá solo.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {visibles.map((c) => (
          <TarjetaWhatsApp
            key={c.id}
            servidor={c}
            {...props}
            onCreada={() => {}}
            onCerrada={(pedido, etiqueta) => {
              cerrar(c.id);
              if (pedido) onConfirmado(pedido, etiqueta);
            }}
          />
        ))}
        {locales.map((n) => (
          <TarjetaWhatsApp
            key={n.clave}
            servidor={null}
            {...props}
            onCreada={(id) => {
              setNuevas((ns) => ns.map((x) => (x.clave === n.clave ? { ...x, conversacionId: id } : x)));
              onRecargar();
            }}
            onCerrada={(pedido, etiqueta) => {
              cerrar(n.conversacionId, n.clave);
              if (pedido) onConfirmado(pedido, etiqueta);
            }}
          />
        ))}
      </div>
    </section>
  );
}
