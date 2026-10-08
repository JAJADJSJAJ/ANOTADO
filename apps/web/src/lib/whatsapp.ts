import type { Conversacion } from '../hooks/useConversaciones.ts';

/** Nombre del perfil de WhatsApp del cliente, si tiene. */
export const nombreCliente = (c: Conversacion['cliente']) => c?.nombre?.trim() || null;

/** +598 99 123 456 para los de Uruguay; el resto, con + y los dígitos. */
export function formatearTelefono(t: string): string {
  const uy = /^598(9\d)(\d{3})(\d{3})$/.exec(t);
  return uy ? `+598 ${uy[1]} ${uy[2]} ${uy[3]}` : `+${t}`;
}
