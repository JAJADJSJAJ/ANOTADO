import { type EstadoPedido, ResultadoEstadoSchema } from '@anotado/shared';
import { supabase } from './supabase.ts';

export type ResultadoEstado =
  | { ok: true; estado: EstadoPedido; cambiado: boolean }
  | { ok: false; error: string };

/**
 * Mueve un pedido un paso. `desde` es el estado que se ve en pantalla: si otro dispositivo
 * ya lo movió, la base no hace nada y devuelve cambiado = false con el estado real.
 */
export async function moverPedido(
  accion: 'avanzar' | 'retroceder',
  pedidoId: string,
  desde: EstadoPedido,
): Promise<ResultadoEstado> {
  const { data, error } = await supabase.rpc(accion === 'avanzar' ? 'avanzar_estado' : 'retroceder_estado', {
    p_pedido_id: pedidoId,
    p_desde: desde,
  });
  return interpretar(data, error);
}

export async function cancelarPedido(pedidoId: string, motivo: string): Promise<ResultadoEstado> {
  const { data, error } = await supabase.rpc('cancelar_pedido', {
    p_pedido_id: pedidoId,
    p_motivo: motivo.trim() || undefined,
  });
  return interpretar(data, error);
}

function interpretar(data: unknown, error: { message: string } | null): ResultadoEstado {
  if (error) {
    // Sin respuesta del servidor: el mensaje de fetch no le sirve a nadie en la cocina.
    const sinRed = /fetch|network|Failed/i.test(error.message);
    return { ok: false, error: sinRed ? 'Sin conexión. Probá de nuevo en un momento.' : error.message };
  }
  const r = ResultadoEstadoSchema.safeParse(data);
  return r.success
    ? { ok: true, estado: r.data.estado, cambiado: r.data.cambiado }
    : { ok: false, error: 'Respuesta inesperada del servidor' };
}
