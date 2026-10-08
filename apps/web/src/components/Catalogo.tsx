import { formatearPrecio } from '@anotado/shared';
import { useState } from 'react';
import type { Categoria, Producto } from '../hooks/useMenu.ts';
import { Vacio } from './Estado.tsx';

const SIN_CATEGORIA = 'sin-categoria';

/** Productos por categoría para cargar un pedido a mano: un toque suma uno. */
export function Catalogo({
  categorias,
  productos,
  enPedido,
  onElegir,
}: {
  categorias: Categoria[];
  productos: Producto[];
  /** Cuántos de cada producto hay ya en el pedido (se marca en la tarjeta). */
  enPedido?: ReadonlyMap<string, number>;
  onElegir: (producto: Producto) => void;
}) {
  const hayHuerfanos = productos.some((p) => !p.categoria_id);
  const pestanas = [
    ...categorias.map((c) => ({ id: c.id, nombre: c.nombre })),
    ...(hayHuerfanos ? [{ id: SIN_CATEGORIA, nombre: 'Otros' }] : []),
  ];
  const [elegida, setElegida] = useState(pestanas[0]?.id ?? SIN_CATEGORIA);
  const visibles = productos.filter((p) => (p.categoria_id ?? SIN_CATEGORIA) === elegida);

  if (productos.length === 0) {
    return <Vacio icono="menu" titulo="Todavía no hay productos en el menú" />;
  }

  return (
    <section aria-label="Productos" className="flex flex-col gap-3">
      <div role="tablist" aria-label="Categorías" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 @2xl:flex-wrap">
        {pestanas.map((c) => {
          const activa = c.id === elegida;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={activa}
              data-sonido="llave"
              onClick={() => setElegida(c.id)}
              className={`h-9 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${
                activa ? 'border-tinta bg-tinta text-white' : 'border-linea-fuerte bg-hoja text-tinta-2 hover:border-tinta-3 hover:text-tinta'
              }`}
            >
              {c.nombre}
            </button>
          );
        })}
      </div>
      <div key={elegida} className="grid animate-aparece grid-cols-2 gap-2 @xl:grid-cols-3 @4xl:grid-cols-4">
        {visibles.map((p) => {
          const cuantos = enPedido?.get(p.id) ?? 0;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!p.activo}
              onClick={() => onElegir(p)}
              className={`group relative flex min-h-[5.5rem] flex-col justify-between gap-2 rounded-xl border bg-hoja p-3 text-left shadow-papel transition-[border-color,transform,box-shadow] duration-150 ease-salida hover:border-tinta-3 active:scale-[0.97] active:shadow-none disabled:border-dashed disabled:bg-transparent disabled:shadow-none ${
                cuantos > 0 ? 'border-tinta' : 'border-linea'
              }`}
            >
              <span className="pr-6 leading-tight font-semibold group-disabled:text-tinta-3">{p.nombre}</span>
              <span className="num text-sm text-tinta-2 group-disabled:text-tinta-3">
                {p.activo ? formatearPrecio(p.precio_centavos) : 'Agotado'}
              </span>
              {cuantos > 0 && (
                <span key={cuantos} className="contador absolute top-2.5 right-2.5 animate-pop">
                  {cuantos}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
