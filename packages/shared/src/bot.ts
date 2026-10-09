import { formatearPrecio } from './dinero.ts';
import type { ProductoMenu } from './reducer.ts';
import type { Borrador } from './schemas.ts';

// Lo que el bot le contesta al cliente después de interpretar sus mensajes (Fase 6).
//
// Se arma con PLANTILLAS a partir del borrador, que está validado contra el menú: el bot nunca
// manda texto libre de la IA, así no puede inventar precios, promociones ni prometer nada. La
// única excepción son las preguntas de aclaración ("¿la coca es de 1,5 o de 2,25?"), que pasan
// por un filtro estricto y si no lo pasan se reemplazan por una genérica.
// Los precios salen siempre de la base: el total lo manda al confirmar y, si el cliente pregunta
// por el menú, el bot nombra los productos con su precio del menú (nunca uno que diga la IA).

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
  /** Productos que responden una pregunta sobre el menú (ids); null si no preguntó. */
  consulta?: readonly string[] | null;
  /** Precio de cada producto del menú (centavos), para contestar la consulta. */
  precios?: ReadonlyMap<string, number>;
};

const MAX_PREGUNTA = 150;
const MAX_CITA = 60;
const MAX_DIRECCION = 120;
const PREGUNTA_GENERICA = '¿Me aclarás qué querías pedir?';

// Lo que la IA o el cliente escribieron solo vuelve en una respuesta si es corto y sin plata, links,
// pagos, pedidos de datos personales (teléfono, mail, documento) ni números largos: el bot solo
// pregunta por productos. Cualquier otra cosa puede ser un intento de manipulación, y en la demo
// compartida otros visitantes ven las respuestas en el mostrador.
const PROHIBIDO =
  /[$<>@\n\r]|https?:|www\.|\.(com|uy|net|org)\b|precio|gratis|descuento|promo|oferta|pag[aáo]|transfer|tarjeta|cuenta|contraseñ|clave|c[oó]digo|tel[eé]fono|celular|whats|mail|correo|c[eé]dula|\bdni\b|documento|\d[\d .-]{4,}\d/i;

// Solo para las preguntas de la IA (no para lo que se cita del cliente): ninguna pide datos de
// contacto o de dónde vive. La dirección de envío la pide la plantilla, no la IA (revisión). Es
// una lista de mejor esfuerzo: lo que se escape es la IA preguntándole un dato al mismo cliente
// en su chat (docs/decisiones.md).
const PIDE_DATOS = /n[uú]mero|direcci[oó]n|domicilio|ubicaci[oó]n|d[oó]nde|altura|barrio|calle|esquina|zona|nombre|apellido|llam[aá]s|contact/i;

/** La pregunta de la IA si es segura para mandarle al cliente; si no, null. */
export function preguntaSegura(pregunta: string): string | null {
  const p = pregunta.trim().replace(/\s+/g, ' ');
  // Tiene que ser una pregunta, aunque cierre con las opciones: "¿De qué tamaño? (600 ml o 1,5 L)".
  if (p.length < 3 || p.length > MAX_PREGUNTA || !p.includes('?') || PROHIBIDO.test(p) || PIDE_DATOS.test(p)) return null;
  return p.startsWith('¿') ? p : `¿${p}`;
}

/** Texto del cliente o de la IA, acotado y en una línea, para citarlo. Null si no se puede citar. */
function citar(texto: string, max = MAX_CITA): string | null {
  const t = texto.trim().replace(/\s+/g, ' ').replace(/[«»"]/g, '');
  if (!t || PROHIBIDO.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
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
    const notas = it.notas ? citar(it.notas) : null;
    return [`${it.cantidad} ${nombre}${notas ? ` (${notas})` : ''}`];
  });
  return partes.length ? enumerar(partes) : null;
}

/** La respuesta del bot, o null si no hay nada que decir (un "gracias" que no cambió nada). */
export function respuestaBot(d: DatosRespuesta): string | null {
  const preguntas = [...new Set(d.preguntas.map((p) => preguntaSegura(p) ?? PREGUNTA_GENERICA))];
  const dudosos = d.dudosos.map((t) => citar(t));
  const consulta = d.consulta ?? null;
  const hayNovedad = d.cambio || preguntas.length > 0 || dudosos.length > 0 || d.errores > 0;
  if (!hayNovedad && consulta === null && !d.primera) return null;

  const lineas: string[] = [];
  if (d.primera) lineas.push(`¡Hola! Te atiende el asistente de ${d.negocio}.`);

  // Solo una pregunta sobre el menú: se contesta eso, sin repetir el pedido.
  if (consulta !== null && !hayNovedad) {
    lineas.push(contestarConsulta(consulta, d));
    lineas.push(d.borrador.items.length ? '¿Querés agregar algo?' : '¿Qué te gustaría pedir?');
    return lineas.join('\n');
  }

  const items = describirItems(d.borrador, d.menu);
  const entrega = d.borrador.entrega;
  if (items) {
    let detalle = '';
    if (entrega?.modo === 'retiro') detalle = ', para retirar';
    else if (entrega?.modo === 'delivery' && entrega.direccion) {
      const direccion = citar(entrega.direccion, MAX_DIRECCION);
      detalle = direccion ? `, para enviar a ${direccion}` : ', para enviar a la dirección que nos pasaste';
    } else if (entrega?.modo === 'mesa' && entrega.mesa) {
      const mesa = citar(entrega.mesa, 20);
      if (mesa) detalle = `, para la mesa ${mesa}`;
    }
    lineas.push(`Anoté: ${items}${detalle}.`);
  }
  if (consulta !== null) lineas.push(contestarConsulta(consulta, d));

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

/** "Tenemos Muzzarella ($ 450) y Napolitana ($ 520)." o que no hay. Solo nombres y precios del menú. */
function contestarConsulta(ids: readonly string[], d: DatosRespuesta): string {
  const nombres = new Map(d.menu.map((p) => [p.id, p.nombre]));
  const partes = ids.flatMap((id) => {
    const nombre = nombres.get(id);
    if (!nombre) return [];
    const precio = d.precios?.get(id);
    return [precio === undefined ? nombre : `${nombre} (${formatearPrecio(precio)})`];
  });
  return partes.length ? `Tenemos ${enumerar(partes)}.` : 'Lo que preguntaste no lo tenemos en el menú.';
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
