import { z } from 'zod';
import { MAX_CANTIDAD, MAX_DIRECCION, MAX_ITEMS, MAX_MESA, MAX_NOTAS, MAX_NOTAS_ITEM } from './reglas.ts';

export const EntregaSchema = z.discriminatedUnion('modo', [
  z.object({ modo: z.literal('retiro') }),
  z.object({
    modo: z.literal('delivery'),
    direccion: z.string().trim().min(1).max(MAX_DIRECCION),
    /** Zona de envío que eligió el cajero. El costo lo pone la RPC, nunca la pantalla. */
    zona_id: z.uuid().optional(),
  }),
  z.object({ modo: z.literal('mesa'), mesa: z.string().trim().min(1).max(MAX_MESA) }),
]);

/**
 * Entrega mientras el pedido se arma: puede estar incompleta (el cliente dijo "mandámelo"
 * pero todavía no la dirección). Al confirmar se exige EntregaSchema completa.
 */
export const EntregaBorradorSchema = z.discriminatedUnion('modo', [
  z.object({ modo: z.literal('retiro') }),
  z.object({ modo: z.literal('delivery'), direccion: z.string().trim().max(MAX_DIRECCION).optional() }),
  z.object({ modo: z.literal('mesa'), mesa: z.string().trim().max(MAX_MESA).optional() }),
]);

export const ItemBorradorSchema = z.object({
  producto_id: z.uuid(),
  cantidad: z.int().min(1).max(MAX_CANTIDAD),
  notas: z.string().trim().max(MAX_NOTAS_ITEM).optional(),
});

/** Pedido en armado: lo edita el cajero a mano (Fase 1) o la IA vía acciones (Fase 2). */
export const BorradorSchema = z.object({
  items: z.array(ItemBorradorSchema).max(MAX_ITEMS),
  entrega: EntregaBorradorSchema.nullable(),
});

export const OrigenSchema = z.enum(['whatsapp', 'mostrador', 'telefono', 'mesa']);

/** Lo que la web manda a la RPC confirmar_pedido. Sin precios: los pone el servidor. */
export const ConfirmarPedidoSchema = z.object({
  origen: OrigenSchema,
  items: z.array(ItemBorradorSchema).min(1).max(MAX_ITEMS),
  entrega: EntregaSchema.nullable(),
  notas: z.string().trim().max(MAX_NOTAS).optional(),
});

export type Entrega = z.infer<typeof EntregaSchema>;
export type EntregaBorrador = z.infer<typeof EntregaBorradorSchema>;
export type ItemBorrador = z.infer<typeof ItemBorradorSchema>;
export type Borrador = z.infer<typeof BorradorSchema>;
export type Origen = z.infer<typeof OrigenSchema>;
export type ConfirmarPedido = z.infer<typeof ConfirmarPedidoSchema>;

/**
 * Lo que la IA no pudo resolver sola, guardado en conversaciones.pendientes.
 * dudosos y preguntas se acumulan hasta que el cajero los resuelve; errores son de la
 * última interpretación.
 */
export const PendientesSchema = z.object({
  dudosos: z.array(z.string().max(300)).max(30).default([]),
  preguntas: z.array(z.string().max(300)).max(30).default([]),
  errores: z.array(z.string().max(300)).max(30).default([]),
});

export type Pendientes = z.infer<typeof PendientesSchema>;
