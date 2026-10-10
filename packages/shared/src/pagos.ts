import { z } from 'zod';

// Formas de pago que acepta el local (negocios.config.pagos). Solo los medios: los datos para
// transferir los pasa el local a mano, para que el bot nunca mande una cuenta (si alguien
// entrara a la cuenta del dueño y la cambiara, la plata iría a otro lado).

export const MEDIOS_PAGO = ['efectivo', 'debito', 'credito', 'transferencia', 'mercadopago'] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number];

export const ETIQUETA_PAGO: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  mercadopago: 'Mercado Pago',
};

export const PagosSchema = z.array(z.enum(MEDIOS_PAGO)).max(MEDIOS_PAGO.length);

/** Los medios guardados en negocios.config, en el orden de MEDIOS_PAGO. Mal formado = ninguno. */
export function leerPagos(config: unknown): MedioPago[] {
  const pagos = typeof config === 'object' && config !== null ? (config as { pagos?: unknown }).pagos : undefined;
  const r = PagosSchema.safeParse(pagos);
  return r.success ? MEDIOS_PAGO.filter((m) => r.data.includes(m)) : [];
}
