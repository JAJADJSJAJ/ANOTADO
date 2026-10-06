import {
  type Borrador,
  type ConfirmarPedido,
  ConfirmarPedidoSchema,
  type Entrega,
  type EntregaBorrador,
  type Origen,
} from '@anotado/shared';
import { supabase } from './supabase.ts';

export type ModoEntrega = 'retiro' | 'delivery' | 'mesa';

/**
 * Entrega tal como se edita en pantalla. modo null = todavía no se eligió. zonaId '' = sin
 * zona. La zona la elige el cajero: no está en el borrador de la IA.
 */
export type DatosEntrega = { modo: ModoEntrega | null; direccion: string; mesa: string; zonaId: string };

export const ENTREGA_RETIRO: DatosEntrega = { modo: 'retiro', direccion: '', mesa: '', zonaId: '' };
export const ENTREGA_SIN_ELEGIR: DatosEntrega = { modo: null, direccion: '', mesa: '', zonaId: '' };

/** zonaId: la que ya había elegido el cajero (la IA no la conoce y no la pisa). */
export function desdeEntregaBorrador(e: EntregaBorrador | null, zonaId = ''): DatosEntrega {
  if (!e) return { ...ENTREGA_SIN_ELEGIR, zonaId };
  if (e.modo === 'delivery') return { modo: 'delivery', direccion: e.direccion ?? '', mesa: '', zonaId };
  if (e.modo === 'mesa') return { modo: 'mesa', direccion: '', mesa: e.mesa ?? '', zonaId };
  return { ...ENTREGA_RETIRO, zonaId };
}

export function aEntregaBorrador(d: DatosEntrega): EntregaBorrador | null {
  if (d.modo === 'delivery') return d.direccion.trim() ? { modo: 'delivery', direccion: d.direccion.trim() } : { modo: 'delivery' };
  if (d.modo === 'mesa') return d.mesa.trim() ? { modo: 'mesa', mesa: d.mesa.trim() } : { modo: 'mesa' };
  if (d.modo === 'retiro') return { modo: 'retiro' };
  return null;
}

export type PedidoConfirmado = { numero: number; total_centavos: number; envio_centavos: number };

type DatosPedido = {
  origen: Origen;
  borrador: Borrador;
  entrega: DatosEntrega;
  notas: string;
};

/** Valida en pantalla y arma lo que va a la RPC. Devuelve el error listo para mostrar. */
function validar(args: DatosPedido): { ok: true; pedido: ConfirmarPedido } | { ok: false; error: string } {
  const { entrega } = args;
  if (!entrega.modo) return { ok: false, error: 'Elegí cómo se entrega el pedido.' };
  if (entrega.modo === 'delivery' && !entrega.direccion.trim()) return { ok: false, error: 'Escribí la dirección del delivery.' };
  if (entrega.modo === 'mesa' && !entrega.mesa.trim()) return { ok: false, error: 'Escribí el número de mesa.' };

  const datosEntrega: Entrega =
    entrega.modo === 'delivery'
      ? { modo: 'delivery', direccion: entrega.direccion, ...(entrega.zonaId && { zona_id: entrega.zonaId }) }
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
  return { ok: true, pedido: pedido.data };
}

/**
 * Valida en pantalla y confirma con la RPC. No manda precios: el servidor los toma de la base.
 * Devuelve el error listo para mostrar.
 */
export async function confirmarPedido(
  args: DatosPedido & { negocioId: string },
): Promise<{ ok: true; pedido: PedidoConfirmado } | { ok: false; error: string }> {
  const v = validar(args);
  if (!v.ok) return v;
  const { data, error } = await supabase.rpc('confirmar_pedido', {
    p_negocio_id: args.negocioId,
    p_origen: v.pedido.origen,
    p_items: v.pedido.items,
    p_entrega: v.pedido.entrega,
    p_notas: v.pedido.notas,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, pedido: data as PedidoConfirmado };
}

/**
 * Confirma una tarjeta de WhatsApp. Además de lo de confirmarPedido, manda la versión de la
 * tarjeta y cuántos mensajes se ven en pantalla: si llegó algo que el cajero no vio, la base
 * no confirma (cambio = true) y la pantalla se actualiza.
 */
export async function confirmarConversacion(
  args: Omit<DatosPedido, 'origen'> & { negocioId: string; conversacionId: string; version: number; mensajes: number },
): Promise<{ ok: true; pedido: PedidoConfirmado } | { ok: false; error: string; cambio?: boolean }> {
  const v = validar({ ...args, origen: 'whatsapp' });
  if (!v.ok) return v;
  const { data, error } = await supabase.rpc('confirmar_conversacion', {
    p_negocio_id: args.negocioId,
    p_conversacion_id: args.conversacionId,
    p_version: args.version,
    p_mensajes: args.mensajes,
    p_items: v.pedido.items,
    p_entrega: v.pedido.entrega,
    p_notas: v.pedido.notas,
  });
  if (error) return { ok: false, error: error.message, cambio: error.code === '40001' };
  return { ok: true, pedido: data as PedidoConfirmado };
}
