import { z } from 'zod';

// Confirmación automática (negocios.config.auto). Las reglas se aplican en la base
// (confirmar_automatico, mismos valores por defecto y topes que config_auto): esto es para la
// pantalla de Administrar y para que el servidor sepa si probar.

export type ConfigAuto = {
  activa: boolean;
  /** Pedidos más caros van a mano. */
  maxTotalCentavos: number;
  /** Más unidades de un mismo producto van a mano. */
  maxPorProducto: number;
  /** Pedidos automáticos por cliente por jornada. */
  maxPedidosClienteDia: number;
  /** Con esta cantidad de pedidos esperando en la cocina, los nuevos van a mano. */
  maxEnCocina: number;
  /** El primer pedido de un cliente lo confirma una persona. */
  nuevosAMano: boolean;
  /** Minutos sin confirmar antes de avisarle al cliente que hay demora. */
  esperaMinutos: number;
};

export const CONFIG_AUTO_DEFECTO: ConfigAuto = {
  activa: false,
  maxTotalCentavos: 300000,
  maxPorProducto: 6,
  maxPedidosClienteDia: 3,
  maxEnCocina: 15,
  nuevosAMano: true,
  esperaMinutos: 10,
};

/** Lo que se guarda en negocios.config.auto (mismos límites que config_auto en la base). */
export const ConfigAutoSchema = z.object({
  activa: z.boolean(),
  max_total_centavos: z.int().min(0).max(100_000_000),
  max_por_producto: z.int().min(1).max(20),
  max_pedidos_cliente_dia: z.int().min(1).max(50),
  max_en_cocina: z.int().min(1).max(500),
  nuevos_a_mano: z.boolean(),
  espera_minutos: z.int().min(1).max(240),
});

export function leerConfigAuto(config: unknown): ConfigAuto {
  const auto = typeof config === 'object' && config !== null ? (config as { auto?: unknown }).auto : undefined;
  const r = ConfigAutoSchema.partial().safeParse(auto ?? {});
  if (!r.success) return CONFIG_AUTO_DEFECTO;
  const d = r.data;
  return {
    activa: d.activa ?? CONFIG_AUTO_DEFECTO.activa,
    maxTotalCentavos: d.max_total_centavos ?? CONFIG_AUTO_DEFECTO.maxTotalCentavos,
    maxPorProducto: d.max_por_producto ?? CONFIG_AUTO_DEFECTO.maxPorProducto,
    maxPedidosClienteDia: d.max_pedidos_cliente_dia ?? CONFIG_AUTO_DEFECTO.maxPedidosClienteDia,
    maxEnCocina: d.max_en_cocina ?? CONFIG_AUTO_DEFECTO.maxEnCocina,
    nuevosAMano: d.nuevos_a_mano ?? CONFIG_AUTO_DEFECTO.nuevosAMano,
    esperaMinutos: d.espera_minutos ?? CONFIG_AUTO_DEFECTO.esperaMinutos,
  };
}

export function aConfigGuardada(c: ConfigAuto): z.infer<typeof ConfigAutoSchema> {
  return {
    activa: c.activa,
    max_total_centavos: c.maxTotalCentavos,
    max_por_producto: c.maxPorProducto,
    max_pedidos_cliente_dia: c.maxPedidosClienteDia,
    max_en_cocina: c.maxEnCocina,
    nuevos_a_mano: c.nuevosAMano,
    espera_minutos: c.esperaMinutos,
  };
}

/**
 * "Eso es todo", "nada más", "con eso estoy": el cliente terminó de pedir. Red de seguridad por si
 * la IA no lo marca (una vez lo tomó como "¿cómo va mi pedido?"). Una pregunta no cuenta: "¿es todo
 * lo que tienen?".
 */
export function dijoQueTermino(texto: string): boolean {
  if (texto.includes('?')) return false;
  const t = texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return /\b(eso es todo|es todo|eso seria todo|seria todo|nada mas|eso nomas|eso solo|con eso (estoy|esta|alcanza))\b/.test(t);
}

/**
 * Un "sí" corto a "¿Lo confirmo?": red de seguridad por si la IA no lo marca. Solo frases enteras
 * de afirmación ("sí", "dale", "sí, confirmalo", "ok gracias"); cualquier otra cosa la ve la IA.
 */
export function esAfirmacion(texto: string): boolean {
  const t = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 40) return false;
  const palabras = new Set(['si', 'sii', 'siii', 'dale', 'ok', 'okey', 'oka', 'confirmo', 'confirma', 'confirmalo', 'confirmamelo',
    'de', 'una', 'perfecto', 'joya', 'listo', 'esta', 'bien', 'gracias', 'porfa', 'por', 'favor', 'va', 'claro', 'obvio', 'y', 'asi']);
  const ps = t.split(' ');
  // Tiene que empezar afirmando y no decir nada que no sea afirmar o agradecer.
  return /^(si+|dale|ok|okey|oka|confirm|de una|perfecto|joya|listo|esta bien|claro|obvio|va)/.test(t) && ps.every((p) => palabras.has(p));
}

/** Por qué un pedido no se confirmó solo, en palabras para el cajero (motivo de confirmar_automatico). */
export function motivoManual(motivo: string, detalle?: string | null): string | null {
  switch (motivo) {
    case 'apagada':
    case 'cerrada':
      return null;
    case 'pendientes':
      return 'Hay algo para revisar en el pedido';
    case 'vacio':
      return 'El pedido está vacío';
    case 'entrega':
      return 'Falta saber cómo se entrega';
    case 'zona':
      return 'Es delivery: elegí la zona de envío';
    case 'tope_producto':
      return 'Supera el máximo de unidades por producto';
    case 'tope_total':
      return 'Supera el total máximo para confirmar solo';
    case 'agotado':
      return 'Algún producto está agotado';
    case 'cliente_nuevo':
      return 'Es el primer pedido de este cliente';
    case 'tope_cliente':
      return 'El cliente ya hizo varios pedidos automáticos hoy';
    case 'cocina_llena':
      return 'La cocina tiene muchos pedidos esperando';
    case 'cerrado':
      return 'El local está cerrado según los horarios';
    case 'tope_demo':
      return 'La demo llegó al límite de pedidos de hoy';
    case 'stock':
    case 'invalido':
      return detalle ?? 'No se pudo confirmar solo';
    default:
      return 'No se pudo confirmar solo';
  }
}
