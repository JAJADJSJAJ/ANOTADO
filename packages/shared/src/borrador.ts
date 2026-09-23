import { MAX_CANTIDAD, MAX_ITEMS } from './reglas.ts';
import type { Borrador } from './schemas.ts';

// Operaciones puras sobre el borrador. Nunca mutan: devuelven un borrador nuevo.

export function borradorVacio(): Borrador {
  return { items: [], entrega: null };
}

const limitar = (cantidad: number) => Math.min(Math.max(Math.trunc(cantidad), 1), MAX_CANTIDAD);
const limpiarNotas = (notas?: string) => notas?.trim() || undefined;

/**
 * Suma un producto. Si ya hay una línea del mismo producto con las mismas notas, suma la
 * cantidad (hasta MAX_CANTIDAD); si no, agrega una línea nueva (hasta MAX_ITEMS líneas).
 */
export function agregarItem(b: Borrador, productoId: string, cantidad = 1, notas?: string): Borrador {
  const n = limpiarNotas(notas);
  const i = b.items.findIndex((it) => it.producto_id === productoId && it.notas === n);
  if (i >= 0) {
    return cambiarCantidad(b, i, b.items[i]!.cantidad + cantidad);
  }
  if (b.items.length >= MAX_ITEMS) return b;
  const item = { producto_id: productoId, cantidad: limitar(cantidad), ...(n && { notas: n }) };
  return { ...b, items: [...b.items, item] };
}

/** Cambia la cantidad de una línea. Menos de 1 la quita. */
export function cambiarCantidad(b: Borrador, index: number, cantidad: number): Borrador {
  if (!b.items[index]) return b;
  if (cantidad < 1) return quitarItem(b, index);
  return { ...b, items: b.items.map((it, i) => (i === index ? { ...it, cantidad: limitar(cantidad) } : it)) };
}

export function quitarItem(b: Borrador, index: number): Borrador {
  return { ...b, items: b.items.filter((_, i) => i !== index) };
}

export function cambiarNotas(b: Borrador, index: number, notas: string): Borrador {
  if (!b.items[index]) return b;
  return {
    ...b,
    items: b.items.map((it, i) => {
      if (i !== index) return it;
      const n = limpiarNotas(notas);
      const base = { producto_id: it.producto_id, cantidad: it.cantidad };
      return n ? { ...base, notas: n } : base;
    }),
  };
}

/** Total para MOSTRAR mientras se arma. El total real lo calcula el servidor al confirmar. */
export function totalEstimado(b: Borrador, precios: ReadonlyMap<string, number>): number {
  return b.items.reduce((suma, it) => suma + (precios.get(it.producto_id) ?? 0) * it.cantidad, 0);
}
