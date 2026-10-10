import { formatearPrecio } from './dinero.ts';
import { ETIQUETA_PAGO, type MedioPago } from './pagos.ts';
import type { ProductoMenu, ResultadoAcciones } from './reducer.ts';
import { MAX_CANTIDAD } from './reglas.ts';
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
  /** Parte de los errores: lo que no se anotó por pasarse del máximo por producto. */
  excedidos?: ResultadoAcciones['excedidos'];
  /** Productos que estaban en el pedido y esta interpretación sacó (nombres). */
  sacados?: readonly string[];
  /** El borrador cambió con esta interpretación. */
  cambio: boolean;
  /** El bot todavía no le escribió nada en esta conversación. */
  primera: boolean;
  /** Productos que responden una pregunta sobre el menú (ids); null si no preguntó. */
  consulta?: readonly string[] | null;
  /** Precio de cada producto del menú (centavos), para contestar la consulta. */
  precios?: ReadonlyMap<string, number>;
  /** El cliente dijo que terminó de pedir (listo_para_confirmar de la IA). */
  listo?: boolean;
  /** Preguntó cómo va su pedido: el último de hoy, o null si no hay. undefined = no preguntó. */
  estadoPedido?: PedidoDelCliente | null;
  /** Preguntó cómo pagar: los medios del local. undefined = no preguntó. */
  pagos?: readonly MedioPago[];
  /** Pidió cancelar. */
  cancelacion?: Cancelacion;
  /** Confirmación automática al terminar: preguntar "¿Lo confirmo?", avisar que falta stock, o a mano. */
  confirmacion?: Confirmacion;
  /** Productos que estaban en el pedido y se agotaron mientras tanto (se sacaron solos). */
  seTerminaron?: readonly string[];
};

/** pregunta: se le manda el total y "¿Lo confirmo?". sin_stock: se terminó algo. a_mano: lo confirma el local. */
export type Confirmacion = { tipo: 'pregunta'; total: number } | { tipo: 'sin_stock'; detalle: string } | { tipo: 'a_mano' };

/** Último pedido del cliente, como lo ve el bot. */
export type PedidoDelCliente = {
  numero: number;
  estado: 'pendiente' | 'en_cocina' | 'listo' | 'entregado' | 'cancelado';
  modo: 'retiro' | 'delivery' | 'mesa' | null;
};

/**
 * Cómo terminó un pedido de cancelación. 'borrador': se vació lo que estaba armando.
 * pedido + cancelado: lo canceló el servidor (el aviso lo manda la base: el bot no repite).
 * pedido sin cancelar: ya estaba en cocina o entregado, le avisa al local. null: no había pedido.
 */
export type Cancelacion = 'borrador' | { pedido: PedidoDelCliente; cancelado: boolean } | null;

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
  // Quien pregunta por un pedido que ya hizo ya conoce al bot: no se lo presenta de nuevo.
  const yaPidio = d.estadoPedido !== undefined || (d.cancelacion !== undefined && d.cancelacion !== 'borrador');
  const saludo = d.primera && !yaPidio ? [`¡Hola! Te atiende el asistente de ${d.negocio}.`] : [];

  // Cancelar lo que estaba armando: se dice eso y nada más.
  if (d.cancelacion === 'borrador') {
    return [...saludo, 'Listo, cancelé el pedido. Si querés pedir otra cosa, escribime.'].join('\n');
  }
  // Respuestas a lo que preguntó o pidió y no cambia productos (cancelar, estado, pagos).
  const avisos: string[] = [];
  if (d.cancelacion !== undefined) {
    const c = d.cancelacion;
    if (c === null) avisos.push('No encontré un pedido tuyo de hoy para cancelar.');
    else if (!c.cancelado) avisos.push(noSePuedeCancelar(c.pedido));
    // Cancelado por el servidor: el aviso "se canceló" lo manda la base.
  }
  if (d.estadoPedido !== undefined) avisos.push(contarEstado(d.estadoPedido, d.borrador.items.length > 0));
  if (d.pagos !== undefined) avisos.push(contarPagos(d.pagos));

  const terminados = d.seTerminaron ?? [];
  const excedidos = d.excedidos ?? [];
  // Los demás errores (producto que no está, notas largas…) los resuelve el local.
  const otrosErrores = d.errores - excedidos.length;
  const hayNovedad = d.cambio || preguntas.length > 0 || dudosos.length > 0 || d.errores > 0 || terminados.length > 0;
  // Dijo que terminó y el pedido está completo: se le avisa que el local confirma.
  const completo = d.borrador.items.length > 0 && entregaCompleta(d.borrador.entrega);
  const terminoAhora = d.listo === true && completo;
  if (!hayNovedad && consulta === null && !terminoAhora) {
    if (avisos.length) return [...saludo, ...avisos].join('\n');
    // Ya se canceló un pedido confirmado: el aviso lo mandó la base, no hace falta saludar.
    if (typeof d.cancelacion === 'object' && d.cancelacion?.cancelado) return null;
    return d.primera ? [...saludo, '¿Qué te gustaría pedir?'].join('\n') : null;
  }

  const lineas: string[] = [...saludo, ...avisos];
  if (terminoAhora && !hayNovedad && consulta === null) {
    // Con la pregunta de confirmación va el resumen completo: el cliente confirma lo que ve.
    if (d.confirmacion?.tipo === 'pregunta') {
      lineas.push(`Tu pedido: ${describirItems(d.borrador, d.menu)}${detalleEntrega(d.borrador.entrega)}.`);
    }
    lineas.push(cierreListo(d.confirmacion));
    return lineas.join('\n');
  }

  // Solo una pregunta sobre el menú: se contesta eso, sin repetir el pedido.
  if (consulta !== null && !hayNovedad) {
    lineas.push(contestarConsulta(consulta, d));
    lineas.push(d.borrador.items.length ? '¿Querés agregar algo?' : '¿Qué te gustaría pedir?');
    return lineas.join('\n');
  }

  const items = describirItems(d.borrador, d.menu);
  const entrega = d.borrador.entrega;
  if (terminados.length) {
    lineas.push(
      `Perdón: ${terminados.length === 1 ? 'se terminó' : 'se terminaron'} ${enumerar(terminados)} y lo saqué del pedido. ¿Querés cambiarlo por otra cosa?`,
    );
  }
  // Lo que sacó, dicho: si la IA entendió mal ("olvidá las cien"), el cliente lo ve enseguida.
  const sacados = d.sacados ?? [];
  if (sacados.length) lineas.push(`Saqué ${enumerar(sacados)} del pedido.`);
  if (items) lineas.push(`Anoté: ${items}${detalleEntrega(entrega)}.`);
  if (excedidos.length) {
    const partes = excedidos.map((e) => (Number.isSafeInteger(e.cantidad) && e.cantidad < 100_000 ? `${e.cantidad} ${e.nombre}` : e.nombre));
    lineas.push(`No anoté ${enumerar(partes)}: por acá puedo anotar hasta ${MAX_CANTIDAD} de cada producto.`);
  }
  if (consulta !== null) lineas.push(contestarConsulta(consulta, d));

  const citables = dudosos.filter((t): t is string => t !== null);
  // Dudoso es tanto lo que no está en el menú como lo ambiguo ("una coca" con tres tamaños).
  if (citables.length === 1) lineas.push(`No me quedó claro «${citables[0]}»: ¿cuál querías?`);
  else if (citables.length > 1) lineas.push(`No me quedaron claros ${enumerar(citables.map((t) => `«${t}»`))}: ¿cuáles querías?`);
  if (dudosos.length > citables.length && citables.length === 0) preguntas.push(PREGUNTA_GENERICA);

  lineas.push(...new Set(preguntas));
  if (otrosErrores > 0) lineas.push('Hay algo que el local tiene que revisar: enseguida te confirma.');

  const pendiente = preguntas.length > 0 || dudosos.length > 0 || otrosErrores > 0 || terminados.length > 0;
  if (!items) {
    if (!pendiente) lineas.push('¿Qué te gustaría pedir?');
  } else if (!pendiente) {
    if (!entrega) lineas.push('¿Es para retirar o te lo mandamos?');
    else if (entrega.modo === 'delivery' && !entrega.direccion) lineas.push('¿A qué dirección te lo mandamos?');
    else if (d.listo) lineas.push(cierreListo(d.confirmacion));
    else lineas.push('¿Algo más? Cuando esté todo, el local te confirma el total.');
  }
  return lineas.join('\n');
}

/** ", para retirar", ", para enviar a Blandengues 450", ", para la mesa 4" o nada. */
function detalleEntrega(entrega: Borrador['entrega']): string {
  if (entrega?.modo === 'retiro') return ', para retirar';
  if (entrega?.modo === 'delivery' && entrega.direccion) {
    const direccion = citar(entrega.direccion, MAX_DIRECCION);
    return direccion ? `, para enviar a ${direccion}` : ', para enviar a la dirección que nos pasaste';
  }
  if (entrega?.modo === 'mesa' && entrega.mesa) {
    const mesa = citar(entrega.mesa, 20);
    if (mesa) return `, para la mesa ${mesa}`;
  }
  return '';
}

/** Lo que se le dice cuando terminó de pedir, según la confirmación automática. */
function cierreListo(c: Confirmacion | undefined): string {
  if (c?.tipo === 'pregunta') return `Total: ${formatearPrecio(c.total)}. ¿Lo confirmo? Respondé SÍ.`;
  if (c?.tipo === 'sin_stock') {
    const detalle = c.detalle.charAt(0).toLowerCase() + c.detalle.slice(1);
    // "De Fainá quedan 2": todavía hay, puede pedir menos. "Se terminó": otra cosa.
    return c.detalle.startsWith('De ')
      ? `Perdón: ${detalle}. ¿Querés cambiar la cantidad o pedir otra cosa?`
      : `Perdón: ${detalle}. ¿Querés cambiarlo por otra cosa?`;
  }
  return '¡Perfecto! El local lo revisa y te confirma el total en un momento.';
}

function entregaCompleta(e: Borrador['entrega']): boolean {
  if (!e) return false;
  if (e.modo === 'delivery') return Boolean(e.direccion);
  if (e.modo === 'mesa') return Boolean(e.mesa);
  return true;
}

/** Cómo va el pedido, en palabras del local. */
function contarEstado(p: PedidoDelCliente | null, armando: boolean): string {
  if (!p) {
    return armando
      ? 'Tu pedido todavía no está confirmado: cuando esté todo, el local te confirma el total.'
      : 'No encontré un pedido tuyo de hoy. ¿Qué te gustaría pedir?';
  }
  const n = `Tu pedido #${p.numero}`;
  switch (p.estado) {
    case 'pendiente':
      return `${n} ya está en el local: en un ratito empiezan a prepararlo.`;
    case 'en_cocina':
      return `${n} se está preparando.`;
    case 'listo':
      return p.modo === 'retiro'
        ? `${n} está listo. Podés pasar a retirarlo.`
        : p.modo === 'delivery'
          ? `${n} está listo y sale enseguida.`
          : `${n} está listo.`;
    case 'entregado':
      return p.modo === 'delivery' ? `${n} ya salió. ¡Va en camino!` : `${n} ya fue entregado.`;
    case 'cancelado':
      return `${n} se canceló.`;
  }
}

function noSePuedeCancelar(p: PedidoDelCliente): string {
  const n = `Tu pedido #${p.numero}`;
  if (p.estado === 'cancelado') return `${n} ya estaba cancelado.`;
  if (p.estado === 'entregado') return `${n} ya fue entregado: le avisé al local y te contestan por acá.`;
  return `${n} ya se está preparando, así que no lo puedo cancelar yo: le avisé al local y te contestan enseguida.`;
}

function contarPagos(medios: readonly MedioPago[]): string {
  if (!medios.length) return 'Las formas de pago te las confirma el local.';
  const nombres = medios.map((m) => (m === 'mercadopago' ? ETIQUETA_PAGO[m] : ETIQUETA_PAGO[m].toLowerCase()));
  return `Aceptamos ${enumerar(nombres)}.`;
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
