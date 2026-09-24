import { formatearPrecio } from '@anotado/shared';
import { useState } from 'react';
import type { Categoria, Producto } from '../hooks/useMenu.ts';

const SIN_CATEGORIA = 'sin-categoria';

/** Botones grandes por categoría para cargar productos a mano. */
export function Catalogo({
  categorias,
  productos,
  onElegir,
}: {
  categorias: Categoria[];
  productos: Producto[];
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
    return <p className="p-4 text-lg text-stone-600">Todavía no hay productos en el menú.</p>;
  }

  return (
    <section aria-label="Productos" className="flex flex-col gap-3">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap">
        {pestanas.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setElegida(c.id)}
            className={`shrink-0 rounded-xl border-2 px-4 py-3 text-lg font-bold ${
              c.id === elegida ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white'
            }`}
          >
            {c.nombre}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {visibles.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!p.activo}
            onClick={() => onElegir(p)}
            className="flex min-h-24 flex-col justify-between rounded-xl border-2 border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-indigo-300 active:scale-95 disabled:border-dashed disabled:bg-stone-100 disabled:text-stone-400 disabled:shadow-none"
          >
            <span className="text-lg leading-tight font-bold">{p.nombre}</span>
            <span className="text-base font-medium">{p.activo ? formatearPrecio(p.precio_centavos) : 'Agotado'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
