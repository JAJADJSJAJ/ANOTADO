import { useState } from 'react';
import type { Categoria, Producto } from '../hooks/useMenu.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { MensajeError, Vacio } from './Estado.tsx';

/**
 * Marcar y desmarcar agotados, para cualquier rol del local (RPC marcar_agotado). Precios y
 * nombres siguen siendo cosa del dueño, en Menú.
 */
export function Agotados({
  categorias,
  productos,
  onCambio,
}: {
  categorias: Categoria[];
  productos: Producto[];
  onCambio: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function alternar(p: Producto) {
    setOcupado(p.id);
    setError(null);
    const { error } = await supabase.rpc('marcar_agotado', { p_producto_id: p.id, p_agotado: p.activo });
    setOcupado(null);
    if (error) {
      efecto('error');
      setError(error.message);
    }
    onCambio();
  }

  const grupos = [
    ...categorias.map((c) => ({ nombre: c.nombre, productos: productos.filter((p) => p.categoria_id === c.id) })),
    { nombre: 'Otros', productos: productos.filter((p) => !p.categoria_id) },
  ].filter((g) => g.productos.length > 0);

  if (productos.length === 0) return <Vacio icono="menu" titulo="Todavía no hay productos en el menú" />;

  const hay = 'border-linea bg-hoja shadow-papel hover:border-tinta-3';
  const agotado = 'border-alerta bg-alerta-suave';

  return (
    <div className="flex flex-col gap-5">
      {error && <MensajeError>{error}</MensajeError>}
      {grupos.map((g) => (
        <section key={g.nombre}>
          <h3 className="rotulo mb-2.5">{g.nombre}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {g.productos.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={!p.activo}
                disabled={ocupado === p.id}
                data-sonido="llave"
                onClick={() => void alternar(p)}
                className={`flex min-h-[4.75rem] flex-col justify-between gap-2 rounded-xl border p-3 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-60 ${
                  p.activo ? hay : agotado
                }`}
              >
                <span className="leading-tight font-semibold">{p.nombre}</span>
                <span
                  className={`chip chip-punto self-start ${p.activo ? 'chip-ok' : 'chip-alerta'}`}
                >
                  {p.activo ? 'Hay' : 'Agotado'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="text-sm text-tinta-3">
        Lo que el dueño sacó del menú también aparece como agotado. Si lo pasás a "Hay", se vuelve a ofrecer.
      </p>
    </div>
  );
}
