import { formatearPrecio, parsearPrecio } from '@anotado/shared';
import { type FormEvent, useState } from 'react';
import { Cargando, MensajeError } from '../components/Estado.tsx';
import { type Categoria, type Producto, useMenu } from '../hooks/useMenu.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { supabase } from '../lib/supabase.ts';

const input = 'rounded-lg border-2 border-neutral-300 px-3 py-2 text-lg';
const botonPrimario = 'rounded-lg bg-neutral-900 px-4 py-2 font-bold text-white disabled:opacity-50';
const botonLink = 'font-medium underline';

/** Categorías, productos, precios, alias y agotados. Solo dueño (lo exige también RLS). */
export function AdminMenu() {
  const negocio = useNegocio();
  const menu = useMenu(negocio.id);
  const [error, setError] = useState<string | null>(null);

  /** Corre una escritura, muestra el error si falla y recarga el menú. */
  async function guardar(accion: PromiseLike<{ error: { message: string; code?: string } | null }>) {
    setError(null);
    const { error } = await accion;
    if (error) {
      setError(
        error.code === '23503'
          ? 'Este producto ya tiene pedidos: marcalo como agotado en vez de borrarlo.'
          : error.message,
      );
      return false;
    }
    await menu.recargar();
    return true;
  }

  if (menu.cargando) return <Cargando />;
  if (menu.error) return <div className="p-4"><MensajeError>{menu.error}</MensajeError></div>;

  const grupos: { categoria: Categoria | null; productos: Producto[] }[] = [
    ...menu.categorias.map((c) => ({ categoria: c, productos: menu.productos.filter((p) => p.categoria_id === c.id) })),
    { categoria: null, productos: menu.productos.filter((p) => !p.categoria_id) },
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Menú</h1>
      {error && <MensajeError>{error}</MensajeError>}

      <NuevaCategoria
        onCrear={(nombre) =>
          guardar(
            supabase.from('categorias').insert({
              negocio_id: negocio.id,
              nombre,
              orden: Math.max(0, ...menu.categorias.map((c) => c.orden)) + 1,
            }),
          )
        }
      />

      {grupos.map(({ categoria, productos }) =>
        !categoria && productos.length === 0 ? null : (
          <section key={categoria?.id ?? 'sin'} className="flex flex-col gap-2 rounded-xl bg-white p-4">
            <EncabezadoCategoria
              categoria={categoria}
              onRenombrar={(nombre) => guardar(supabase.from('categorias').update({ nombre }).eq('id', categoria!.id))}
              onBorrar={() => {
                if (!confirm(`¿Borrar la categoría "${categoria!.nombre}"? Sus productos quedan en "Sin categoría".`)) return;
                void guardar(supabase.from('categorias').delete().eq('id', categoria!.id));
              }}
            />
            <ul className="divide-y divide-neutral-200">
              {productos.map((p) => (
                <FilaProducto
                  key={p.id}
                  producto={p}
                  categorias={menu.categorias}
                  onGuardar={(datos) => guardar(supabase.from('productos').update(datos).eq('id', p.id))}
                  onBorrar={() => {
                    if (!confirm(`¿Borrar "${p.nombre}"?`)) return;
                    void guardar(supabase.from('productos').delete().eq('id', p.id));
                  }}
                />
              ))}
            </ul>
            {categoria && (
              <NuevoProducto
                categoria={categoria}
                categorias={menu.categorias}
                onCrear={(datos) => guardar(supabase.from('productos').insert({ ...datos, negocio_id: negocio.id }))}
              />
            )}
          </section>
        ),
      )}
    </main>
  );
}

function NuevaCategoria({ onCrear }: { onCrear: (nombre: string) => Promise<boolean> }) {
  const [nombre, setNombre] = useState('');
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nombre.trim() && (await onCrear(nombre.trim()))) setNombre('');
  }
  return (
    <form onSubmit={enviar} className="flex gap-2">
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nueva categoría"
        aria-label="Nombre de la nueva categoría"
        className={`${input} flex-1`}
      />
      <button type="submit" className={botonPrimario} disabled={!nombre.trim()}>
        Agregar
      </button>
    </form>
  );
}

function EncabezadoCategoria(p: {
  categoria: Categoria | null;
  onRenombrar: (nombre: string) => Promise<boolean>;
  onBorrar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(p.categoria?.nombre ?? '');

  if (!p.categoria) return <h2 className="text-xl font-bold text-neutral-500">Sin categoría</h2>;

  if (editando) {
    return (
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (nombre.trim() && (await p.onRenombrar(nombre.trim()))) setEditando(false);
        }}
      >
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={`${input} flex-1`} autoFocus />
        <button type="submit" className={botonPrimario}>Guardar</button>
        <button type="button" className={botonLink} onClick={() => setEditando(false)}>Cancelar</button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <h2 className="flex-1 text-xl font-bold">{p.categoria.nombre}</h2>
      <button type="button" className={botonLink} onClick={() => setEditando(true)}>Renombrar</button>
      <button type="button" className={`${botonLink} text-red-700`} onClick={p.onBorrar}>Borrar</button>
    </div>
  );
}

type DatosProducto = { nombre: string; precio_centavos: number; alias: string[]; categoria_id: string | null };

function FilaProducto(p: {
  producto: Producto;
  categorias: Categoria[];
  onGuardar: (datos: Partial<DatosProducto> & { activo?: boolean }) => Promise<boolean>;
  onBorrar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const prod = p.producto;

  if (editando) {
    return (
      <li className="py-3">
        <FormProducto
          inicial={prod}
          categorias={p.categorias}
          textoBoton="Guardar"
          onGuardar={async (datos) => {
            if (await p.onGuardar(datos)) setEditando(false);
          }}
          onCancelar={() => setEditando(false)}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <div className="min-w-40 flex-1">
        <p className={`text-lg font-bold ${prod.activo ? '' : 'text-neutral-400 line-through'}`}>{prod.nombre}</p>
        {prod.alias.length > 0 && <p className="text-sm text-neutral-500">También: {prod.alias.join(', ')}</p>}
      </div>
      <span className="text-lg font-medium">{formatearPrecio(prod.precio_centavos)}</span>
      <button
        type="button"
        onClick={() => void p.onGuardar({ activo: !prod.activo })}
        className={`rounded-lg border-2 px-3 py-2 font-bold ${
          prod.activo ? 'border-emerald-600 text-emerald-700' : 'border-amber-500 bg-amber-50 text-amber-800'
        }`}
      >
        {prod.activo ? 'Disponible' : 'Agotado'}
      </button>
      <button type="button" className={botonLink} onClick={() => setEditando(true)}>Editar</button>
      <button type="button" className={`${botonLink} text-red-700`} onClick={p.onBorrar}>Borrar</button>
    </li>
  );
}

function NuevoProducto(p: {
  categoria: Categoria;
  categorias: Categoria[];
  onCrear: (datos: DatosProducto) => Promise<boolean>;
}) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button type="button" className={`${botonLink} self-start`} onClick={() => setAbierto(true)}>
        + Producto en {p.categoria.nombre}
      </button>
    );
  }
  return (
    <FormProducto
      inicial={{ nombre: '', precio_centavos: null, alias: [], categoria_id: p.categoria.id }}
      categorias={p.categorias}
      textoBoton="Agregar"
      onGuardar={async (datos) => {
        if (await p.onCrear(datos)) setAbierto(false);
      }}
      onCancelar={() => setAbierto(false)}
    />
  );
}

function FormProducto(p: {
  inicial: { nombre: string; precio_centavos: number | null; alias: string[]; categoria_id: string | null };
  categorias: Categoria[];
  textoBoton: string;
  onGuardar: (datos: DatosProducto) => Promise<void>;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(p.inicial.nombre);
  const [precio, setPrecio] = useState(
    p.inicial.precio_centavos === null ? '' : formatearPrecio(p.inicial.precio_centavos).replace('$ ', ''),
  );
  const [alias, setAlias] = useState(p.inicial.alias.join(', '));
  const [categoriaId, setCategoriaId] = useState(p.inicial.categoria_id ?? '');
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const centavos = parsearPrecio(precio);
    if (!nombre.trim()) return setError('Falta el nombre.');
    if (centavos === null) return setError('Precio inválido. Ej: 280 o 125,50');
    setError(null);
    await p.onGuardar({
      nombre: nombre.trim(),
      precio_centavos: centavos,
      // "completa, compl" → ["completa","compl"], sin vacíos ni repetidos.
      alias: [...new Set(alias.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean))],
      categoria_id: categoriaId || null,
    });
  }

  return (
    <form onSubmit={enviar} className="grid gap-2 rounded-lg bg-neutral-50 p-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 font-medium">
        Nombre
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={input} autoFocus />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Precio ($)
        <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" className={input} />
      </label>
      <label className="flex flex-col gap-1 font-medium sm:col-span-2">
        Otros nombres que usan los clientes (separados por coma)
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="completa, compl" className={input} />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Categoría
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className={input}>
          <option value="">Sin categoría</option>
          {p.categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" className={botonPrimario}>{p.textoBoton}</button>
        <button type="button" className={botonLink} onClick={p.onCancelar}>Cancelar</button>
      </div>
      {error && <div className="sm:col-span-2"><MensajeError>{error}</MensajeError></div>}
    </form>
  );
}
