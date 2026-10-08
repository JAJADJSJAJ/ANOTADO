import type { ProductoMenu } from './reducer.ts';
import type { Borrador } from './schemas.ts';

// Lo que el bot le contesta al cliente después de interpretar sus mensajes (Fase 6).
//
// Se arma con PLANTILLAS a partir del borrador, que está validado contra el menú: el bot nunca
// manda texto libre de la IA, así no puede inventar precios, promociones ni prometer nada. La
// única excepción son las preguntas de aclaración ("¿la coca es de 1,5 o de 2,25?"), que pasan
// por un filtro estricto y si no lo pasan se reemplazan por una genérica.
// Los precios y el total los manda la base al confirmar, nunca esto.

export type DatosRespuesta = {
  /** Nombre del local, para el saludo. */
  negocio: string;
  borrador: Borrador;
  /** Menú activo (para los nombres de los productos). */
  menu: readonly ProductoMenu[];
  /** Lo que salió de ESTA interpretación (no lo acumulado). */
  preguntas: readonly string[];
  dudosos: readonly string[];
  errores: number;
  /** El borrador cambió con esta interpretación. */
  cambio: boolean;
  /** El bot todavía no le escribió nada en esta conversación. */
  primera: boolean;
};

const MAX_PREGUNTA = 150;
const MAX_DUDOSO = 60;
const PREGUNTA_GENERICA = '¿Me aclarás qué querías pedir?';

// Una pregunta corta, que termina en "?", sin plata, links ni temas de pago: la IA solo puede
// preguntar por productos. Cualquier otra cosa puede ser un intento de manipulación.
const PROHIBIDO = /[$<>\n\r]|https?:|www\.|\.(com|uy|net|org)\b|precio|gratis|descuento|promo|oferta|pag[aáo]|transfer|tarjeta|cuenta|contraseñ|clave|c[oó]digo/i;

/** La pregunta de la IA si es segura para mandarle al cliente; si no, null. */
export function preguntaSegura(pregunta: string): string | null {
  const p = pregunta.trim().replace(/\s+/g, ' ');
  if (p.length < 3 || p.length > MAX_PREGUNTA || !p.endsWith('?') || PROHIBIDO.test(p)) return null;
  return p.startsWith('¿') ? p : `¿${p}`;
}

/** Lo que escribió el cliente, acotado y en una línea, para citarlo. Null si no se puede citar. */
function citar(texto: string): string | null {
  const t = texto.trim().replace(/\s+/g, ' ').replace(/[«»"]/g, '');
  if (!t || PROHIBIDO.test(t)) return null;
  return t.length > MAX_DUDOSO ? `${t.slice(0, MAX_DUDOSO - 1)}…` : t;
}

/** "a", "a y b", "a, b y c". */
function enumerar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;
}

function describirItems(borrador: Borrador, menu: readonly ProductoMenu[]): string | null {
  const nombres = new Map(menu.map((p) => [p.id, p.nombre]));
  const partes = borrador.items.flatMap((it) => {
    const nombre = nombres.get(it.producto_id);
    if (!nombre) return [];
    return [`${it.cantidad} ${nombre}${it.notas ? ` (${it.notas})` : ''}`];
  });
  return partes.length ? enumerar(partes) : null;
}

/** La respuesta del bot, o null si no hay nada que decir (un "gracias" que no cambió nada). */
export function respuestaBot(d: DatosRespuesta): string | null {
  const preguntas = [...new Set(d.preguntas.map((p) => preguntaSegura(p) ?? PREGUNTA_GENERICA))];
  const dudosos = d.dudosos.map(citar);
  const hayNovedad = d.cambio || preguntas.length > 0 || dudosos.length > 0 || d.errores > 0;
  if (!hayNovedad && !d.primera) return null;

  const lineas: string[] = [];
  if (d.primera) lineas.push(`¡Hola! Te atiende el asistente de ${d.negocio}.`);

  const items = describirItems(d.borrador, d.menu);
  const entrega = d.borrador.entrega;
  if (items) {
    let detalle = '';
    if (entrega?.modo === 'retiro') detalle = ', para retirar';
    else if (entrega?.modo === 'delivery' && entrega.direccion) detalle = `, para enviar a ${entrega.direccion}`;
    else if (entrega?.modo === 'mesa' && entrega.mesa) detalle = `, para la mesa ${entrega.mesa}`;
    lineas.push(`Anoté: ${items}${detalle}.`);
  }

  const citables = dudosos.filter((t): t is string => t !== null);
  // Dudoso es tanto lo que no está en el menú como lo ambiguo ("una coca" con tres tamaños).
  if (citables.length === 1) lineas.push(`No me quedó claro «${citables[0]}»: ¿cuál querías?`);
  else if (citables.length > 1) lineas.push(`No me quedaron claros ${enumerar(citables.map((t) => `«${t}»`))}: ¿cuáles querías?`);
  if (dudosos.length > citables.length && citables.length === 0) preguntas.push(PREGUNTA_GENERICA);

  lineas.push(...new Set(preguntas));
  if (d.errores > 0) lineas.push('Hay algo que el local tiene que revisar: enseguida te confirma.');

  const pendiente = preguntas.length > 0 || dudosos.length > 0 || d.errores > 0;
  if (!items) {
    if (!pendiente) lineas.push('¿Qué te gustaría pedir?');
  } else if (!pendiente) {
    if (!entrega) lineas.push('¿Es para retirar o te lo mandamos?');
    else if (entrega.modo === 'delivery' && !entrega.direccion) lineas.push('¿A qué dirección te lo mandamos?');
    else lineas.push('¿Algo más? Cuando esté todo, el local te confirma el total.');
  }
  return lineas.join('\n');
}

/**
 * Teléfono de mentira del cliente del simulador de la demo: siempre el mismo para el mismo
 * visitante, y empieza con 00 (ningún número real de WhatsApp).
 */
export function telefonoDemo(userId: string): string {
  const hex = userId.replace(/[^0-9a-f]/gi, '') || '0';
  const n = BigInt(`0x${hex}`) % 10_000_000_000n;
  return `00${n.toString().padStart(10, '0')}`;
}
