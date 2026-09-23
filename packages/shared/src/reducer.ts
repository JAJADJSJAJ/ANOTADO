import type { AccionIA } from './acciones.ts';
import { agregarItem, quitarItem } from './borrador.ts';
import { MAX_CANTIDAD, MAX_DIRECCION, MAX_ITEMS, MAX_MESA, MAX_NOTAS_ITEM } from './reglas.ts';
import type { Borrador, EntregaBorrador } from './schemas.ts';

/** Producto del menú tal como se le mostró a la IA. */
export type ProductoMenu = {
  id: string;
  /** Referencia corta que ve la IA en el prompt (p1, p2…). */
  ref: string;
  nombre: string;
  activo: boolean;
};

export type ResultadoAcciones = {
  borrador: Borrador;
  /** Textos que la IA no pudo asociar a un producto. El cajero elige. */
  dudosos: string[];
  /** Preguntas de aclaración para el cliente (en Fase 6 las manda el bot). */
  preguntas: string[];
  /** Acciones rechazadas por reglas: producto inexistente, agotado, cantidad absurda… */
  errores: string[];
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

  const lineasDe = (productoId: string) =>
    b.items.flatMap((it, i) => (it.producto_id === productoId ? [i] : []));

  for (const a of acciones) {
    switch (a.tipo) {
      case 'agregar': {
        const p = porRef.get(a.producto);
        if (!p) {
          errores.push(`Producto desconocido: "${a.producto}"`);
          break;
        }
        const error = validarProducto(p) ?? validarCantidad(p, a.cantidad) ?? validarNotas(p, a.notas);
        if (error) {
          errores.push(error);
          break;
        }
        const notas = a.notas?.trim() || undefined;
        const existente = b.items.find((it) => it.producto_id === p.id && it.notas === notas);
        if (existente && existente.cantidad + a.cantidad > MAX_CANTIDAD) {
          errores.push(`${p.nombre}: sumando quedarían ${existente.cantidad + a.cantidad} (máximo ${MAX_CANTIDAD})`);
          break;
        }
        if (!existente && b.items.length >= MAX_ITEMS) {
          errores.push(`Máximo ${MAX_ITEMS} productos distintos por pedido`);
          break;
        }
        b = agregarItem(b, p.id, a.cantidad, notas);
        break;
      }

      case 'quitar': {
        const p = porRef.get(a.producto);
        if (!p) {
          errores.push(`Producto desconocido: "${a.producto}"`);
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
          errores.push(`Producto desconocido: "${a.producto}"`);
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
        const texto = a.texto_original.trim();
        if (texto) dudosos.push(texto);
        break;
      }

      case 'aclarar': {
        const pregunta = a.pregunta.trim();
        if (pregunta) preguntas.push(pregunta);
        break;
      }
    }
  }

  return { borrador: b, dudosos, preguntas, errores };
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
