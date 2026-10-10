import type { AccionIA } from './acciones.ts';
import { agregarItem, quitarItem } from './borrador.ts';
import { fonetica, separarCantidad } from './fonetica.ts';
import { MAX_CANTIDAD, MAX_CONSULTA, MAX_DIRECCION, MAX_ITEMS, MAX_MESA, MAX_NOTAS_ITEM } from './reglas.ts';
import type { Borrador, EntregaBorrador } from './schemas.ts';

/** Sin la referencia interna (p7…): al cajero no le dice nada. */
const PRODUCTO_DESCONOCIDO = 'La IA nombró un producto que no está en el menú';

/** Largo máximo de un dudoso o una pregunta (lo que venga de la IA se recorta). */
export const MAX_TEXTO_PENDIENTE = 300;

/** Producto del menú tal como se le mostró a la IA. */
export type ProductoMenu = {
  id: string;
  /** Referencia corta que ve la IA en el prompt (p1, p2…). */
  ref: string;
  nombre: string;
  activo: boolean;
  /** Nombre y otros nombres, para reconocer lo que la IA dejó como dudoso (fonetica.ts). */
  claves?: readonly string[];
};

export type ResultadoAcciones = {
  borrador: Borrador;
  /** Textos que la IA no pudo asociar a un producto. El cajero elige. */
  dudosos: string[];
  /** Preguntas de aclaración para el cliente (en Fase 6 las manda el bot). */
  preguntas: string[];
  /** Acciones rechazadas por reglas: producto inexistente, agotado, cantidad absurda… */
  errores: string[];
  /** Lo que no se anotó por pasarse del máximo por producto (el bot se lo dice al cliente). */
  excedidos: { nombre: string; cantidad: number }[];
  /**
   * El cliente preguntó por el menú: ids de los productos que responden (activos, sin repetir).
   * null = no preguntó; [] = preguntó por algo que no hay.
   */
  consulta: string[] | null;
  /** Preguntó cómo va su pedido. */
  estado: boolean;
  /** Preguntó cómo se puede pagar. */
  pago: boolean;
  /**
   * Pidió cancelar. 'borrador': había un pedido armándose y se vació. 'pedido': no había nada
   * armado, así que habla del último pedido confirmado (lo resuelve el servidor). null: no pidió.
   */
  cancelar: 'borrador' | 'pedido' | null;
};

/**
 * Aplica las acciones de la IA sobre el borrador. Función pura: sin IA, sin base, sin red.
 *
 * Cada acción se valida por separado: una inválida se descarta y se informa en `errores`,
 * las demás se aplican igual. La IA propone; nada de esto crea un pedido.
 */
export function aplicarAcciones(
  borradorInicial: Borrador,
  acciones: readonly AccionIA[],
  menu: readonly ProductoMenu[],
): ResultadoAcciones {
  const porRef = new Map(menu.map((p) => [p.ref, p]));
  let b = borradorInicial;
  const dudosos: string[] = [];
  const preguntas: string[] = [];
  const errores: string[] = [];
  const excedidos: ResultadoAcciones['excedidos'] = [];
  let consulta: string[] | null = null;
  let estado = false;
  let pago = false;
  let cancelar: ResultadoAcciones['cancelar'] = null;

  const lineasDe = (productoId: string) =>
    b.items.flatMap((it, i) => (it.producto_id === productoId ? [i] : []));

  /** Suma un producto validando reglas; si no se puede, lo deja en errores. */
  const agregar = (p: ProductoMenu, cantidad: number, notasIA: string | null) => {
    const error = validarProducto(p) ?? validarCantidad(p, cantidad) ?? validarNotas(p, notasIA);
    if (error) {
      if (p.activo && cantidad > MAX_CANTIDAD) excedidos.push({ nombre: p.nombre, cantidad });
      return errores.push(error);
    }
    const notas = notasIA?.trim() || undefined;
    const existente = b.items.find((it) => it.producto_id === p.id && it.notas === notas);
    if (existente && existente.cantidad + cantidad > MAX_CANTIDAD) {
      excedidos.push({ nombre: p.nombre, cantidad: existente.cantidad + cantidad });
      return errores.push(`${p.nombre}: sumando quedarían ${existente.cantidad + cantidad} (máximo ${MAX_CANTIDAD})`);
    }
    if (!existente && b.items.length >= MAX_ITEMS) return errores.push(`Máximo ${MAX_ITEMS} productos distintos por pedido`);
    b = agregarItem(b, p.id, cantidad, notas);
  };

  for (const a of acciones) {
    switch (a.tipo) {
      case 'agregar': {
        const p = porRef.get(a.producto);
        if (!p) {
          errores.push(PRODUCTO_DESCONOCIDO);
          break;
        }
        agregar(p, a.cantidad, a.notas);
        break;
      }

      case 'quitar': {
        const p = porRef.get(a.producto);
        if (!p) {
          errores.push(PRODUCTO_DESCONOCIDO);
          break;
        }
        const lineas = lineasDe(p.id);
        if (lineas.length === 0) {
          errores.push(`${p.nombre} no estaba en el pedido`);
          break;
        }
        // De atrás para adelante para que los índices sigan valiendo.
        for (const i of lineas.reverse()) b = quitarItem(b, i);
        break;
      }

      case 'modificar': {
        const p = porRef.get(a.producto);
        if (!p) {
          errores.push(PRODUCTO_DESCONOCIDO);
          break;
        }
        const lineas = lineasDe(p.id);
        if (lineas.length > 1) {
          errores.push(`Hay varias líneas de ${p.nombre}: revisalo a mano`);
          break;
        }
        const error =
          (a.cantidad !== null ? validarCantidad(p, a.cantidad) : null) ?? validarNotas(p, a.notas);
        if (error) {
          if (a.cantidad !== null && a.cantidad > MAX_CANTIDAD) excedidos.push({ nombre: p.nombre, cantidad: a.cantidad });
          errores.push(error);
          break;
        }
        if (lineas.length === 0) {
          // "mejor que sean 3 completas" sin completas en el pedido: se agregan.
          if (a.cantidad === null) {
            errores.push(`${p.nombre} no estaba en el pedido`);
            break;
          }
          const noDisponible = validarProducto(p);
          if (noDisponible) {
            errores.push(noDisponible);
            break;
          }
          b = agregarItem(b, p.id, a.cantidad, a.notas ?? undefined);
          break;
        }
        const i = lineas[0]!;
        b = {
          ...b,
          items: b.items.map((it, j) => {
            if (j !== i) return it;
            const cantidad = a.cantidad ?? it.cantidad;
            const notas = a.notas === null ? it.notas : a.notas.trim() || undefined;
            return notas ? { producto_id: it.producto_id, cantidad, notas } : { producto_id: it.producto_id, cantidad };
          }),
        };
        break;
      }

      case 'entrega': {
        const resultado = construirEntrega(a, b.entrega);
        if (typeof resultado === 'string') errores.push(resultado);
        else b = { ...b, entrega: resultado };
        break;
      }

      case 'dudoso': {
        const texto = a.texto_original.trim().slice(0, MAX_TEXTO_PENDIENTE);
        if (!texto) break;
        // Escrito como suena ("2 virras" = 2 birras): si suena igual a UN producto, es ese.
        const reconocido = reconocerPorSonido(texto, menu);
        if (reconocido) agregar(reconocido.producto, reconocido.cantidad, null);
        else dudosos.push(texto);
        break;
      }

      case 'aclarar': {
        const pregunta = a.pregunta.trim().slice(0, MAX_TEXTO_PENDIENTE);
        if (pregunta) preguntas.push(pregunta);
        break;
      }

      case 'consultar': {
        // Referencias que no están en el menú se ignoran: una consulta no toca el pedido.
        const ids = a.productos.flatMap((ref) => {
          const p = porRef.get(ref);
          return p?.activo ? [p.id] : [];
        });
        consulta = [...new Set([...(consulta ?? []), ...ids])].slice(0, MAX_CONSULTA);
        break;
      }

      case 'estado':
        estado = true;
        break;

      case 'pago':
        pago = true;
        break;

      case 'cancelar':
        // Con algo armado, se cancela eso (sin pedido no hay nada que cocinar). Sin nada armado,
        // habla de un pedido ya confirmado, que no se toca acá.
        if (b.items.length > 0 || cancelar === 'borrador') {
          b = { items: [], entrega: null };
          cancelar = 'borrador';
        } else {
          cancelar = 'pedido';
        }
        break;
    }
  }

  return { borrador: b, dudosos, preguntas, errores, excedidos, consulta, estado, pago, cancelar };
}

/** El producto que "suena igual" a todo el texto, si es uno solo (con su cantidad). */
function reconocerPorSonido(
  texto: string,
  menu: readonly ProductoMenu[],
): { producto: ProductoMenu; cantidad: number } | null {
  const { cantidad, resto } = separarCantidad(texto);
  const clave = fonetica(resto);
  if (clave.length < 3) return null;
  const candidatos = menu.filter((p) => p.activo && (p.claves ?? [p.nombre]).some((k) => fonetica(k) === clave));
  return candidatos.length === 1 ? { producto: candidatos[0]!, cantidad } : null;
}

function validarProducto(p: ProductoMenu): string | null {
  return p.activo ? null : `${p.nombre} está agotado`;
}

function validarCantidad(p: ProductoMenu, cantidad: number): string | null {
  return Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= MAX_CANTIDAD
    ? null
    : `${p.nombre}: cantidad ${cantidad} fuera de rango (1–${MAX_CANTIDAD})`;
}

function validarNotas(p: ProductoMenu, notas: string | null): string | null {
  return notas && notas.trim().length > MAX_NOTAS_ITEM
    ? `${p.nombre}: notas de más de ${MAX_NOTAS_ITEM} caracteres`
    : null;
}

/**
 * Nueva entrega a partir de la acción. Si la acción no trae dirección o mesa pero la entrega
 * anterior era del mismo modo, se conserva el dato ("mandámelo" después de dar la dirección).
 */
function construirEntrega(
  a: Extract<AccionIA, { tipo: 'entrega' }>,
  anterior: EntregaBorrador | null,
): EntregaBorrador | string {
  if (a.modo === 'retiro') return { modo: 'retiro' };

  if (a.modo === 'delivery') {
    const direccion = a.direccion?.trim() || (anterior?.modo === 'delivery' ? anterior.direccion : undefined);
    if (direccion && direccion.length > MAX_DIRECCION) return `Dirección de más de ${MAX_DIRECCION} caracteres`;
    return direccion ? { modo: 'delivery', direccion } : { modo: 'delivery' };
  }

  const mesa = a.mesa?.trim() || (anterior?.modo === 'mesa' ? anterior.mesa : undefined);
  if (mesa && mesa.length > MAX_MESA) return `Mesa de más de ${MAX_MESA} caracteres`;
  return mesa ? { modo: 'mesa', mesa } : { modo: 'mesa' };
}
