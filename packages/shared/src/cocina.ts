import { z } from 'zod';

// Estados y permisos espejados en la migración cocina.sql (puede_mover_estado). Si cambia
// uno, cambia el otro. Acá son solo UX: la base es la que decide.

export const EstadoPedidoSchema = z.enum(['pendiente', 'en_cocina', 'listo', 'entregado', 'cancelado']);
export type EstadoPedido = z.infer<typeof EstadoPedidoSchema>;
export type RolMiembro = 'dueno' | 'cajero' | 'cocina';

const SIGUIENTE: Partial<Record<EstadoPedido, EstadoPedido>> = {
  pendiente: 'en_cocina',
  en_cocina: 'listo',
  listo: 'entregado',
};
const ANTERIOR: Partial<Record<EstadoPedido, EstadoPedido>> = {
  en_cocina: 'pendiente',
  listo: 'en_cocina',
  entregado: 'listo',
};

export const siguienteEstado = (e: EstadoPedido): EstadoPedido | null => SIGUIENTE[e] ?? null;
export const estadoAnterior = (e: EstadoPedido): EstadoPedido | null => ANTERIOR[e] ?? null;

/** Cocina cocina (pendiente → en cocina → listo), el mostrador entrega, el dueño todo. */
function rolesDelPaso(desde: EstadoPedido, hacia: EstadoPedido): readonly RolMiembro[] {
  const paso = `${desde}>${hacia}`;
  if (['pendiente>en_cocina', 'en_cocina>listo', 'en_cocina>pendiente', 'listo>en_cocina'].includes(paso)) {
    return ['dueno', 'cocina'];
  }
  if (['listo>entregado', 'entregado>listo'].includes(paso)) return ['dueno', 'cajero'];
  return [];
}

export function puedeAvanzar(rol: RolMiembro, estado: EstadoPedido): boolean {
  const hacia = siguienteEstado(estado);
  return hacia !== null && rolesDelPaso(estado, hacia).includes(rol);
}

/** Deshacer: lo puede quien pudo hacer el paso que se deshace. */
export function puedeRetroceder(rol: RolMiembro, estado: EstadoPedido): boolean {
  const hacia = estadoAnterior(estado);
  return hacia !== null && rolesDelPaso(estado, hacia).includes(rol);
}

/** Cancelar: solo el mostrador, y nunca un pedido entregado o ya cancelado. */
export function puedeCancelar(rol: RolMiembro, estado: EstadoPedido): boolean {
  return (rol === 'dueno' || rol === 'cajero') && ['pendiente', 'en_cocina', 'listo'].includes(estado);
}

// Respuesta de pedidos_cocina ---------------------------------------------------------------

export const ItemCocinaSchema = z.object({
  nombre: z.string(),
  cantidad: z.int(),
  notas: z.string().nullable(),
});

export const PedidoCocinaSchema = z.object({
  id: z.uuid(),
  numero: z.int(),
  estado: EstadoPedidoSchema,
  origen: z.enum(['whatsapp', 'mostrador', 'telefono', 'mesa']),
  modo_entrega: z.enum(['retiro', 'delivery', 'mesa']).nullable(),
  mesa: z.string().nullable(),
  notas: z.string().nullable(),
  created_at: z.string(),
  items: z.array(ItemCocinaSchema),
});

export const RespuestaCocinaSchema = z.object({
  ahora: z.string(),
  pedidos: z.array(PedidoCocinaSchema),
});

export type ItemCocina = z.infer<typeof ItemCocinaSchema>;
export type PedidoCocina = z.infer<typeof PedidoCocinaSchema>;

/** Aviso de Realtime: solo id y estado. Lo demás se recarga por la RPC. */
export const AvisoPedidoSchema = z.object({
  pedido_id: z.uuid(),
  estado: EstadoPedidoSchema,
});

// Temporizador ------------------------------------------------------------------------------

/** Minutos para pasar a amarillo y a rojo. Los define el dueño en negocios.config.cocina. */
export type ConfigCocina = { amarilloMin: number; rojoMin: number };

export const CONFIG_COCINA_DEFECTO: ConfigCocina = { amarilloMin: 10, rojoMin: 20 };
export const MAX_MINUTOS_COCINA = 240;

const minutos = z.int().min(1).max(MAX_MINUTOS_COCINA);
export const ConfigCocinaSchema = z
  .object({ amarillo_min: minutos, rojo_min: minutos })
  .refine((c) => c.rojo_min > c.amarillo_min, { message: 'El rojo tiene que ser después del amarillo' });

/**
 * Lee config.cocina del negocio. Si falta o está mal (config es jsonb libre), usa los
 * valores por defecto: una tablet nunca se queda sin temporizador por un dato raro.
 */
export function leerConfigCocina(config: unknown): ConfigCocina {
  const cocina = typeof config === 'object' && config !== null ? (config as Record<string, unknown>).cocina : undefined;
  const r = ConfigCocinaSchema.safeParse(cocina);
  return r.success ? { amarilloMin: r.data.amarillo_min, rojoMin: r.data.rojo_min } : CONFIG_COCINA_DEFECTO;
}

export type ColorTemporizador = 'verde' | 'amarillo' | 'rojo';

/** Verde hasta amarilloMin, amarillo hasta rojoMin, rojo después. */
export function colorTemporizador(minutosTranscurridos: number, config: ConfigCocina): ColorTemporizador {
  if (minutosTranscurridos >= config.rojoMin) return 'rojo';
  if (minutosTranscurridos >= config.amarilloMin) return 'amarillo';
  return 'verde';
}

/** Minutos enteros desde que entró el pedido. ahoraMs es la hora del servidor estimada. */
export function minutosDesde(createdAt: string, ahoraMs: number): number {
  const ms = ahoraMs - Date.parse(createdAt);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}

/**
 * Diferencia entre el reloj del servidor y el de la tablet. Se toma el punto medio de la
 * solicitud para descontar la latencia. Sumarla a Date.now() da la hora del servidor.
 */
export function desfaseReloj(ahoraServidor: string, inicioMs: number, finMs: number): number {
  const servidor = Date.parse(ahoraServidor);
  return Number.isFinite(servidor) ? servidor - (inicioMs + finMs) / 2 : 0;
}

// Lista -------------------------------------------------------------------------------------

/** Lo más viejo primero (a la izquierda); a igual hora, por número. */
export function ordenarPedidos<T extends Pick<PedidoCocina, 'created_at' | 'numero'>>(pedidos: readonly T[]): T[] {
  return [...pedidos].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.numero - b.numero);
}

/** Pedidos pendientes que no estaban en la lista anterior: son los que hacen sonar la alerta. */
export function pedidosNuevos(anteriores: readonly Pick<PedidoCocina, 'id'>[], actuales: readonly PedidoCocina[]): PedidoCocina[] {
  const vistos = new Set(anteriores.map((p) => p.id));
  return actuales.filter((p) => p.estado === 'pendiente' && !vistos.has(p.id));
}

/** Texto corto de cómo sale el pedido, para la tarjeta de cocina. */
export function textoEntrega(p: Pick<PedidoCocina, 'modo_entrega' | 'mesa'>): string {
  if (p.modo_entrega === 'delivery') return 'Delivery';
  if (p.modo_entrega === 'mesa') return p.mesa ? `Mesa ${p.mesa}` : 'Mesa';
  if (p.modo_entrega === 'retiro') return 'Retira';
  return 'Sin definir';
}
