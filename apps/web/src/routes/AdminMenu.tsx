import { formatearPrecio, parsearPrecio } from '@anotado/shared';
import { type FormEvent, useState } from 'react';
import { Cargando, MensajeError, Nota } from '../components/Estado.tsx';
import { Icono } from '../components/Icono.tsx';
import { Interruptor } from '../components/Interruptor.tsx';
import { type Categoria, type Producto, useMenu } from '../hooks/useMenu.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { usePreguntar } from '../lib/dialogos.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { Encabezado } from './AdminLayout.tsx';

/** Categorías, productos, precios, alias y agotados. Solo dueño (lo exige también RLS). */
export function AdminMenu() {
  const negocio = useNegocio();
  const menu = useMenu(negocio.id);
  const preguntar = usePreguntar();
  const [error, setError] = useState<string | null>(null);

  /** Corre una escritura, muestra el error si falla y recarga el menú. */
  async function guardar(accion: PromiseLike<{ error: { message: string; code?: string } | null }>) {
    setError(null);
    const { error } = await accion;
    if (error) {
      efecto('error');
      setError(
        error.code === '23503' ? 'Este producto ya tiene pedidos: marcalo como agotado en vez de borrarlo.' : error.message,
      );
      return false;
    }
    await menu.recargar();
    return true;
  }

  if (menu.cargando) return <Cargando />;
  if (menu.error) return <MensajeError>{menu.error}</MensajeError>;

  const grupos: { categoria: Categoria | null; productos: Producto[] }[] = [
    ...menu.categorias.map((c) => ({ categoria: c, productos: menu.productos.filter((p) => p.categoria_id === c.id) })),
    { categoria: null, productos: menu.productos.filter((p) => !p.categoria_id) },
  ];

  return (
    <>
      <Encabezado titulo="Menú">
        Lo que se puede pedir, con su precio. La IA usa estos nombres para entender a los clientes.
      </Encabezado>
      <div className="flex flex-col gap-4">
        {negocio.esDemo && (
          <Nota tono="alerta">
            En la demo el menú base no se edita. Podés agregar hasta 3 productos tuyos para probar (se borran a la noche)
            y marcar agotados.
          </Nota>
        )}
        {menu.categorias.length === 0 && !negocio.esDemo && (
          <Nota>
            Empezá creando una categoría (por ejemplo, <strong className="font-semibold">Pizzas</strong>) y agregale sus
            productos con el precio. Con el menú cargado ya podés tomar pedidos.
          </Nota>
        )}
        {!negocio.esDemo && (
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
        )}
        {error && <MensajeError>{error}</MensajeError>}

        {grupos.map(({ categoria, productos }) =>
          !categoria && productos.length === 0 ? null : (
            <section key={categoria?.id ?? 'sin'} className="tarjeta animate-entra">
              <EncabezadoCategoria
                categoria={categoria}
                cantidad={productos.length}
                onRenombrar={(nombre) => guardar(supabase.from('categorias').update({ nombre }).eq('id', categoria!.id))}
                onBorrar={async () => {
                  const ok = await preguntar({
                    titulo: `¿Borrar la categoría "${categoria!.nombre}"?`,
                    texto: 'Sus productos no se borran: quedan en "Sin categoría".',
                    aceptar: 'Borrar categoría',
                    peligro: true,
                  });
                  if (ok !== null) void guardar(supabase.from('categorias').delete().eq('id', categoria!.id));
                }}
              />
              <ul className="divide-y divide-linea">
                {productos.map((p) => (
                  <FilaProducto
                    key={p.id}
                    producto={p}
                    categorias={menu.categorias}
                    onGuardar={(datos) => guardar(supabase.from('productos').update(datos).eq('id', p.id))}
                    onBorrar={async () => {
                      const ok = await preguntar({ titulo: `¿Borrar "${p.nombre}"?`, aceptar: 'Borrar', peligro: true });
                      if (ok !== null) void guardar(supabase.from('productos').delete().eq('id', p.id));
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
      </div>
    </>
  );
}

function NuevaCategoria({ onCrear }: { onCrear: (nombre: string) => Promise<boolean> }) {
  const [nombre, setNombre] = useState('');
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nombre.trim() && (await onCrear(nombre.trim()))) {
      efecto('ok');
      setNombre('');
    }
  }
  return (
    <form onSubmit={enviar} className="flex gap-2">
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nueva categoría, por ejemplo Bebidas"
        maxLength={60}
        aria-label="Nombre de la nueva categoría"
        className="campo flex-1"
      />
      <button type="submit" className="btn btn-tinta h-11" disabled={!nombre.trim()} data-sonido="no">
        <Icono nombre="mas" />
        Categoría
      </button>
    </form>
  );
}

function EncabezadoCategoria(p: {
  categoria: Categoria | null;
  cantidad: number;
  onRenombrar: (nombre: string) => Promise<boolean>;
  onBorrar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(p.categoria?.nombre ?? '');

  if (!p.categoria) {
    return (
      <header className="flex items-center gap-3 border-b border-linea px-5 py-3.5">
        <h2 className="font-bold text-tinta-2">Sin categoría</h2>
      </header>
    );
  }

  if (editando) {
    return (
      <form
        className="flex gap-2 border-b border-linea px-5 py-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (nombre.trim() && (await p.onRenombrar(nombre.trim()))) setEditando(false);
        }}
      >
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          maxLength={60}
          aria-label="Nombre de la categoría"
          className="campo campo-chico flex-1"
          autoFocus
        />
        <button type="button" className="btn btn-fantasma btn-chico h-9" onClick={() => setEditando(false)}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-tinta btn-chico h-9">
          Guardar
        </button>
      </form>
    );
  }
  return (
    <header className="group flex items-center gap-2 border-b border-linea px-5 py-3">
      <h2 className="font-bold">{p.categoria.nombre}</h2>
      <span className="num text-sm text-tinta-3">{p.cantidad}</span>
      <div className="ml-auto flex gap-0.5">
        <button type="button" className="btn btn-fantasma btn-icono" aria-label="Renombrar categoría" title="Renombrar" onClick={() => setEditando(true)}>
          <Icono nombre="lapiz" className="size-4" />
        </button>
        <button type="button" className="btn btn-quitar btn-icono" aria-label="Borrar categoría" title="Borrar" onClick={p.onBorrar}>
          <Icono nombre="cerrar" className="size-4" />
        </button>
      </div>
    </header>
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
      <li className="bg-papel/50 px-5 py-4">
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
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${prod.activo ? '' : 'text-tinta-3'}`}>
          {prod.nombre}
          {!prod.activo && <span className="chip chip-alerta ml-2 align-[1px]">Agotado</span>}
        </p>
        {prod.alias.length > 0 && <p className="truncate text-sm text-tinta-3">También: {prod.alias.join(', ')}</p>}
      </div>
      <span className={`num font-semibold ${prod.activo ? '' : 'text-tinta-3'}`}>{formatearPrecio(prod.precio_centavos)}</span>
      <Interruptor prendido={prod.activo} onCambio={(v) => void p.onGuardar({ activo: v })} etiqueta={`${prod.nombre} disponible`} />
      <div className="flex gap-0.5">
        <button type="button" className="btn btn-fantasma btn-icono" aria-label={`Editar ${prod.nombre}`} title="Editar" onClick={() => setEditando(true)}>
          <Icono nombre="lapiz" className="size-4" />
        </button>
        <button type="button" className="btn btn-quitar btn-icono" aria-label={`Borrar ${prod.nombre}`} title="Borrar" onClick={p.onBorrar}>
          <Icono nombre="cerrar" className="size-4" />
        </button>
      </div>
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
      <div className="border-t border-linea px-3 py-2">
        <button type="button" className="btn btn-fantasma btn-chico" onClick={() => setAbierto(true)}>
          <Icono nombre="mas" className="size-4" />
          Producto en {p.categoria.nombre}
        </button>
      </div>
    );
  }
  return (
    <div className="border-t border-linea bg-papel/50 px-5 py-4">
      <FormProducto
        inicial={{ nombre: '', precio_centavos: null, alias: [], categoria_id: p.categoria.id }}
        categorias={p.categorias}
        textoBoton="Agregar"
        onGuardar={async (datos) => {
          if (await p.onCrear(datos)) {
            efecto('ok');
            setAbierto(false);
          }
        }}
        onCancelar={() => setAbierto(false)}
      />
    </div>
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
    // "completa, compl" → ["completa","compl"], sin vacíos ni repetidos.
    const listaAlias = [...new Set(alias.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean))];
    // Mismos límites que la base (validaciones_negocio_menu.sql): el menú va al prompt de la IA.
    if (!nombre.trim()) return setError('Falta el nombre.');
    if (nombre.trim().length > 120) return setError('El nombre puede tener hasta 120 caracteres.');
    if (centavos === null) return setError('Precio inválido. Ej: 280 o 125,50');
    if (listaAlias.length > 20) return setError('Hasta 20 nombres alternativos.');
    if (listaAlias.some((a) => a.length > 60)) return setError('Cada nombre alternativo puede tener hasta 60 caracteres.');
    setError(null);
    await p.onGuardar({
      nombre: nombre.trim(),
      precio_centavos: centavos,
      alias: listaAlias,
      categoria_id: categoriaId || null,
    });
  }

  return (
    <form onSubmit={enviar} className="grid animate-entra gap-3 sm:grid-cols-[1fr_9rem]">
      <label>
        <span className="etiqueta">Nombre</span>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} className="campo" autoFocus />
      </label>
      <label>
        <span className="etiqueta">Precio</span>
        <span className="relative block">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-tinta-3">$</span>
          <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" className="campo num pl-7" />
        </span>
      </label>
      <label className="sm:col-span-2">
        <span className="etiqueta">Otros nombres que usan los clientes</span>
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="completa, compl" className="campo" />
        <span className="mt-1.5 block text-sm text-tinta-3">Separados por coma. Ayudan a la IA a reconocer el producto.</span>
      </label>
      <label>
        <span className="etiqueta">Categoría</span>
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="campo">
          <option value="">Sin categoría</option>
          {p.categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end justify-end gap-2">
        <button type="button" className="btn btn-fantasma h-11" onClick={p.onCancelar}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-tinta h-11" data-sonido="no">
          {p.textoBoton}
        </button>
      </div>
      {error && (
        <div className="sm:col-span-2">
          <MensajeError>{error}</MensajeError>
        </div>
      )}
    </form>
  );
}
