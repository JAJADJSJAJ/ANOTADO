import {
  type Borrador,
  cambiarCantidad,
  cambiarNotas,
  formatearPrecio,
  MAX_CANTIDAD,
  type Origen,
  quitarItem,
  totalEstimado,
} from '@anotado/shared';
import { useState } from 'react';
import type { Producto } from '../hooks/useMenu.ts';
import type { Zona } from '../hooks/useZonas.ts';
import type { DatosEntrega, ModoEntrega } from '../lib/pedidos.ts';
import { MensajeError } from './Estado.tsx';

type Props = {
  titulo?: string;
  vacio?: string;
  borrador: Borrador;
  onBorrador: (b: Borrador) => void;
  productos: ReadonlyMap<string, Producto>;
  /** Zonas de envío activas. Si hay, un delivery tiene que elegir una. */
  zonas: Zona[];
  /** Sin origen (p. ej. tarjetas de WhatsApp) no se muestra el selector. */
  origen?: Origen;
  onOrigen?: (o: Origen) => void;
  entrega: DatosEntrega;
  onEntrega: (e: DatosEntrega) => void;
  notas: string;
  onNotas: (n: string) => void;
  onConfirmar: () => void;
  enviando: boolean;
  error: string | null;
};

const ORIGENES: { valor: Origen; texto: string }[] = [
  { valor: 'mostrador', texto: 'Mostrador' },
  { valor: 'telefono', texto: 'Teléfono' },
  { valor: 'mesa', texto: 'Mesa' },
];

const MODOS: { valor: ModoEntrega; texto: string }[] = [
  { valor: 'retiro', texto: 'Retira' },
  { valor: 'delivery', texto: 'Delivery' },
  { valor: 'mesa', texto: 'Mesa' },
];

export function PanelPedido(p: Props) {
  const precios = new Map([...p.productos].map(([id, prod]) => [id, prod.precio_centavos]));
  const zona = p.entrega.modo === 'delivery' ? p.zonas.find((z) => z.id === p.entrega.zonaId) : undefined;
  const total = totalEstimado(p.borrador, precios) + (zona?.costo_centavos ?? 0);
  const vacio = p.borrador.items.length === 0;

  return (
    <section aria-label={p.titulo ?? 'Pedido'} className="flex flex-col gap-4 rounded-xl bg-white p-4">
      <h2 className="text-xl font-bold">{p.titulo ?? 'Pedido'}</h2>

      {vacio ? (
        <p className="text-stone-500">{p.vacio ?? 'Tocá los productos para agregarlos.'}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {p.borrador.items.map((it, i) => (
            <LineaItem
              key={`${it.producto_id}|${it.notas ?? ''}|${i}`}
              nombre={p.productos.get(it.producto_id)?.nombre ?? 'Producto'}
              precio={p.productos.get(it.producto_id)?.precio_centavos ?? 0}
              cantidad={it.cantidad}
              notas={it.notas ?? ''}
              onCantidad={(c) => p.onBorrador(cambiarCantidad(p.borrador, i, c))}
              onNotas={(n) => p.onBorrador(cambiarNotas(p.borrador, i, n))}
              onQuitar={() => p.onBorrador(quitarItem(p.borrador, i))}
            />
          ))}
        </ul>
      )}

      {p.origen && p.onOrigen && (
        <Segmentado titulo="Origen" opciones={ORIGENES} valor={p.origen} onCambio={p.onOrigen} />
      )}
      <Segmentado
        titulo="Entrega"
        opciones={MODOS}
        valor={p.entrega.modo}
        onCambio={(modo) => p.onEntrega({ ...p.entrega, modo })}
      />
      {p.entrega.modo === 'delivery' && (
        <CampoTexto
          etiqueta="Dirección"
          valor={p.entrega.direccion}
          onCambio={(direccion) => p.onEntrega({ ...p.entrega, direccion })}
        />
      )}
      {p.entrega.modo === 'delivery' && p.zonas.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">Zona de envío</legend>
          <div className="grid grid-cols-2 gap-2">
            {p.zonas.map((z) => (
              <button
                key={z.id}
                type="button"
                aria-pressed={z.id === p.entrega.zonaId}
                onClick={() => p.onEntrega({ ...p.entrega, zonaId: z.id })}
                className={`flex flex-col rounded-lg border-2 px-2 py-2 text-left ${
                  z.id === p.entrega.zonaId ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'
                }`}
              >
                <span className="font-bold leading-tight">{z.nombre}</span>
                <span className="text-sm">{formatearPrecio(z.costo_centavos)}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {p.entrega.modo === 'mesa' && (
        <CampoTexto
          etiqueta="Número de mesa"
          valor={p.entrega.mesa}
          onCambio={(mesa) => p.onEntrega({ ...p.entrega, mesa })}
          inputMode="numeric"
        />
      )}
      <CampoTexto etiqueta="Notas del pedido (opcional)" valor={p.notas} onCambio={p.onNotas} />

      {zona && (
        <div className="flex items-baseline justify-between border-t-2 border-stone-200 pt-3 text-stone-600">
          <span>Envío · {zona.nombre}</span>
          <span className="font-medium">{formatearPrecio(zona.costo_centavos)}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between border-t-2 border-stone-200 pt-3">
        <span className="text-lg font-medium">Total</span>
        <span className="text-3xl font-black">{formatearPrecio(total)}</span>
      </div>

      {p.error && <MensajeError>{p.error}</MensajeError>}

      <button
        type="button"
        onClick={p.onConfirmar}
        disabled={vacio || p.enviando}
        className="rounded-xl bg-emerald-600 py-5 text-2xl font-black text-white active:bg-emerald-700 disabled:bg-stone-300"
      >
        {p.enviando ? 'Confirmando…' : 'Confirmar'}
      </button>
    </section>
  );
}

function LineaItem(p: {
  nombre: string;
  precio: number;
  cantidad: number;
  notas: string;
  onCantidad: (c: number) => void;
  onNotas: (n: string) => void;
  onQuitar: () => void;
}) {
  // La nota se edita local y se guarda al salir del campo: el borrador la recorta y, si se
  // guardara en cada tecla, no se podrían escribir espacios.
  const [editandoNota, setEditandoNota] = useState(false);
  const [texto, setTexto] = useState(p.notas);
  const boton = 'size-11 rounded-lg border-2 border-stone-300 text-2xl font-bold disabled:opacity-40';

  return (
    <li className="flex flex-col gap-2 rounded-lg border-2 border-stone-200 p-2">
      <div className="flex items-center gap-2">
        <button type="button" className={boton} aria-label="Uno menos" onClick={() => p.onCantidad(p.cantidad - 1)}>
          −
        </button>
        <span className="w-8 text-center text-xl font-black">{p.cantidad}</span>
        <button
          type="button"
          className={boton}
          aria-label="Uno más"
          disabled={p.cantidad >= MAX_CANTIDAD}
          onClick={() => p.onCantidad(p.cantidad + 1)}
        >
          +
        </button>
        <span className="flex-1 leading-tight font-bold">{p.nombre}</span>
        <span className="font-medium">{formatearPrecio(p.precio * p.cantidad)}</span>
      </div>
      {editandoNota || p.notas ? (
        <input
          autoFocus={editandoNota}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={() => setEditandoNota(true)}
          onBlur={() => {
            setEditandoNota(false);
            p.onNotas(texto);
          }}
          placeholder="Ej: sin tomate"
          className="rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2"
        />
      ) : null}
      <div className="flex gap-3 text-sm font-medium">
        {!p.notas && !editandoNota && (
          <button type="button" className="text-stone-600 underline" onClick={() => setEditandoNota(true)}>
            + Nota
          </button>
        )}
        <button type="button" className="ml-auto text-red-700 underline" onClick={p.onQuitar}>
          Quitar
        </button>
      </div>
    </li>
  );
}

function Segmentado<T extends string>(p: {
  titulo: string;
  opciones: { valor: T; texto: string }[];
  valor: T | null;
  onCambio: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 font-medium">{p.titulo}</legend>
      <div className="grid grid-cols-3 gap-2">
        {p.opciones.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={o.valor === p.valor}
            onClick={() => p.onCambio(o.valor)}
            className={`rounded-lg border-2 py-3 font-bold ${
              o.valor === p.valor ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'
            }`}
          >
            {o.texto}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CampoTexto(p: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  inputMode?: 'numeric' | 'text';
}) {
  return (
    <label className="flex flex-col gap-1 font-medium">
      {p.etiqueta}
      <input
        value={p.valor}
        inputMode={p.inputMode}
        onChange={(e) => p.onCambio(e.target.value)}
        className="rounded-lg border-2 border-stone-300 px-3 py-3 text-lg"
      />
    </label>
  );
}
