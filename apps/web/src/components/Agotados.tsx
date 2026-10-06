import { useState } from 'react';
import type { Categoria, Producto } from '../hooks/useMenu.ts';
import { supabase } from '../lib/supabase.ts';
import { MensajeError } from './Estado.tsx';

/**
 * Marcar y desmarcar agotados, para cualquier rol del local (RPC marcar_agotado). Precios y
 * nombres siguen siendo cosa del dueño, en Menú.
 */
export function Agotados({
  categorias,
  productos,
  onCambio,
  oscuro = false,
}: {
  categorias: Categoria[];
  productos: Producto[];
  onCambio: () => void;
  oscuro?: boolean;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function alternar(p: Producto) {
    setOcupado(p.id);
    setError(null);
    const { error } = await supabase.rpc('marcar_agotado', { p_producto_id: p.id, p_agotado: p.activo });
    setOcupado(null);
    if (error) setError(error.message);
    onCambio();
  }

  const grupos = [
    ...categorias.map((c) => ({ nombre: c.nombre, productos: productos.filter((p) => p.categoria_id === c.id) })),
    { nombre: 'Otros', productos: productos.filter((p) => !p.categoria_id) },
  ].filter((g) => g.productos.length > 0);

  if (productos.length === 0) return <p className="text-lg">Todavía no hay productos en el menú.</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className={`text-sm ${oscuro ? 'text-stone-400' : 'text-stone-500'}`}>
        Ojo: lo que el dueño sacó del menú también aparece como agotado. Si lo pasás a &quot;Hay&quot;, se vuelve a ofrecer.
      </p>
      {error && <MensajeError>{error}</MensajeError>}
      {grupos.map((g) => (
        <section key={g.nombre}>
          <h3 className={`mb-2 text-sm font-bold tracking-wide uppercase ${oscuro ? 'text-stone-400' : 'text-stone-500'}`}>
            {g.nombre}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {g.productos.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={!p.activo}
                disabled={ocupado === p.id}
                onClick={() => void alternar(p)}
                className={`flex min-h-20 flex-col justify-between rounded-xl border-2 p-3 text-left font-bold disabled:opacity-60 ${
                  p.activo
                    ? oscuro
                      ? 'border-white/15 bg-white/5'
                      : 'border-stone-200 bg-white'
                    : 'border-amber-500 bg-amber-100 text-amber-950'
                }`}
              >
                <span className="leading-tight">{p.nombre}</span>
                <span className={`text-sm ${p.activo ? 'text-emerald-500' : 'text-amber-800'}`}>
                  {p.activo ? 'Hay' : 'Agotado'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
