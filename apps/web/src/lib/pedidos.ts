import { type Borrador, ConfirmarPedidoSchema, type Entrega, type EntregaBorrador, type Origen } from '@anotado/shared';
import { supabase } from './supabase.ts';

export type ModoEntrega = 'retiro' | 'delivery' | 'mesa';

/** Entrega tal como se edita en pantalla. modo null = todavía no se eligió. */
export type DatosEntrega = { modo: ModoEntrega | null; direccion: string; mesa: string };

export const ENTREGA_RETIRO: DatosEntrega = { modo: 'retiro', direccion: '', mesa: '' };
export const ENTREGA_SIN_ELEGIR: DatosEntrega = { modo: null, direccion: '', mesa: '' };

export function desdeEntregaBorrador(e: EntregaBorrador | null): DatosEntrega {
  if (!e) return ENTREGA_SIN_ELEGIR;
  if (e.modo === 'delivery') return { modo: 'delivery', direccion: e.direccion ?? '', mesa: '' };
  if (e.modo === 'mesa') return { modo: 'mesa', direccion: '', mesa: e.mesa ?? '' };
  return ENTREGA_RETIRO;
}

export function aEntregaBorrador(d: DatosEntrega): EntregaBorrador | null {
  if (d.modo === 'delivery') return d.direccion.trim() ? { modo: 'delivery', direccion: d.direccion.trim() } : { modo: 'delivery' };
  if (d.modo === 'mesa') return d.mesa.trim() ? { modo: 'mesa', mesa: d.mesa.trim() } : { modo: 'mesa' };
  if (d.modo === 'retiro') return { modo: 'retiro' };
  return null;
}

export type PedidoConfirmado = { numero: number; total_centavos: number };

/**
 * Valida en pantalla y confirma con la RPC. No manda precios: el servidor los toma de la base.
 * Devuelve el error listo para mostrar.
 */
export async function confirmarPedido(args: {
  negocioId: string;
  origen: Origen;
  borrador: Borrador;
  entrega: DatosEntrega;
  notas: string;
  conversacionId?: string | null;
}): Promise<{ ok: true; pedido: PedidoConfirmado } | { ok: false; error: string }> {
  const { entrega } = args;
  if (!entrega.modo) return { ok: false, error: 'Elegí cómo se entrega el pedido.' };
  if (entrega.modo === 'delivery' && !entrega.direccion.trim()) return { ok: false, error: 'Escribí la dirección del delivery.' };
  if (entrega.modo === 'mesa' && !entrega.mesa.trim()) return { ok: false, error: 'Escribí el número de mesa.' };

  const datosEntrega: Entrega =
    entrega.modo === 'delivery'
      ? { modo: 'delivery', direccion: entrega.direccion }
      : entrega.modo === 'mesa'
        ? { modo: 'mesa', mesa: entrega.mesa }
        : { modo: 'retiro' };

  const pedido = ConfirmarPedidoSchema.safeParse({
    origen: args.origen,
    items: args.borrador.items,
    entrega: datosEntrega,
    notas: args.notas.trim() || undefined,
  });
  if (!pedido.success) return { ok: false, error: 'Revisá el pedido: hay datos inválidos.' };

  const { data, error } = await supabase.rpc('confirmar_pedido', {
    p_negocio_id: args.negocioId,
    p_origen: pedido.data.origen,
    p_items: pedido.data.items,
    p_entrega: pedido.data.entrega,
    p_notas: pedido.data.notas,
    p_conversacion_id: args.conversacionId ?? undefined,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, pedido: data as PedidoConfirmado };
}
