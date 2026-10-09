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
import { type ReactNode, useState } from 'react';
import type { Categoria, Producto } from '../hooks/useMenu.ts';
import type { Zona } from '../hooks/useZonas.ts';
import type { DatosEntrega, ModoEntrega } from '../lib/pedidos.ts';
import { Catalogo } from './Catalogo.tsx';
import { Dialogo } from './Dialogo.tsx';
import { MensajeError, Vacio } from './Estado.tsx';
import { Icono } from './Icono.tsx';
import { Segmentado } from './Segmentado.tsx';

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
  /** Algo para mostrar entre los productos y la entrega (dudas de la IA). */
  extra?: ReactNode;
  /** Si viene, se pueden sumar productos a mano desde el menú (pedidos de WhatsApp). */
  agregar?: { categorias: Categoria[]; onAgregar: (producto: Producto) => void };
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

/**
 * El pedido que se está armando, como una comanda: productos con su cantidad, cómo se
 * entrega, notas y el total. Sin caja propia: lo pone el que lo usa.
 */
export function PanelPedido(p: Props) {
  const precios = new Map([...p.productos].map(([id, prod]) => [id, prod.precio_centavos]));
  const zona = p.entrega.modo === 'delivery' ? p.zonas.find((z) => z.id === p.entrega.zonaId) : undefined;
  const total = totalEstimado(p.borrador, precios) + (zona?.costo_centavos ?? 0);
  const vacio = p.borrador.items.length === 0;
  const unidades = p.borrador.items.reduce((s, it) => s + it.cantidad, 0);
  // Origen y notas se usan poco: quedan plegados (abiertos si ya hay algo distinto de lo normal).
  const [masAbierto, setMasAbierto] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);
  const enPedido = new Map<string, number>();
  for (const it of p.borrador.items) enPedido.set(it.producto_id, (enPedido.get(it.producto_id) ?? 0) + it.cantidad);
  const mas = masAbierto || p.notas.trim() !== '' || (p.origen !== undefined && p.origen !== 'mostrador');

  return (
    <section aria-label={p.titulo ?? 'Pedido'} className="flex h-full min-h-0 flex-col">
      <header className="flex items-baseline gap-2 border-b border-linea px-4 py-3.5">
        <h2 className="truncate font-bold">{p.titulo ?? 'Pedido'}</h2>
        {!vacio && (
          <span className="num ml-auto shrink-0 text-sm text-tinta-3">
            {unidades} {unidades === 1 ? 'producto' : 'productos'}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {vacio ? (
          <Vacio icono="ticket" titulo="Pedido vacío">
            {p.vacio ?? 'Tocá los productos para agregarlos.'}
          </Vacio>
        ) : (
          <ul className="flex flex-col">
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
        {p.agregar && (
          <button type="button" onClick={() => setEligiendo(true)} className="btn btn-chico -mt-1 self-start" data-sonido="abrir">
            <Icono nombre="mas" className="size-4" />
            Agregar producto
          </button>
        )}
        {p.agregar && eligiendo && (
          <Dialogo
            titulo="Agregar al pedido"
            descripcion="Cada toque suma uno. Las cantidades y las notas se cambian después en el pedido."
            onCerrar={() => setEligiendo(false)}
            ancho="max-w-3xl"
          >
            <div className="@container max-h-[60dvh] overflow-y-auto">
              <Catalogo
                categorias={p.agregar.categorias}
                productos={[...p.productos.values()]}
                enPedido={enPedido}
                onElegir={p.agregar.onAgregar}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="num text-sm text-tinta-3">
                {unidades} {unidades === 1 ? 'producto' : 'productos'} en el pedido
              </span>
              <button type="button" onClick={() => setEligiendo(false)} className="btn btn-tinta">
                Listo
              </button>
            </div>
          </Dialogo>
        )}

        {p.extra}

        <Grupo titulo="Entrega">
          <Segmentado
            etiqueta="Entrega"
            opciones={MODOS}
            valor={p.entrega.modo}
            onCambio={(modo) => p.onEntrega({ ...p.entrega, modo })}
          />
        </Grupo>
        {p.entrega.modo === 'delivery' && (
          <CampoTexto
            etiqueta="Dirección"
            valor={p.entrega.direccion}
            onCambio={(direccion) => p.onEntrega({ ...p.entrega, direccion })}
          />
        )}
        {p.entrega.modo === 'delivery' && p.zonas.length > 0 && (
          <Grupo titulo="Zona de envío">
            <div className="grid grid-cols-2 gap-1.5">
              {p.zonas.map((z) => {
                const elegida = z.id === p.entrega.zonaId;
                return (
                  <button
                    key={z.id}
                    type="button"
                    aria-pressed={elegida}
                    data-sonido="llave"
                    onClick={() => p.onEntrega({ ...p.entrega, zonaId: z.id })}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      elegida ? 'border-tinta bg-tinta text-white' : 'border-linea-fuerte hover:border-tinta-3'
                    }`}
                  >
                    <span className="truncate font-semibold">{z.nombre}</span>
                    <span className={`num shrink-0 ${elegida ? 'text-white/75' : 'text-tinta-3'}`}>{formatearPrecio(z.costo_centavos)}</span>
                  </button>
                );
              })}
            </div>
          </Grupo>
        )}
        {p.entrega.modo === 'mesa' && (
          <CampoTexto
            etiqueta="Número de mesa"
            valor={p.entrega.mesa}
            onCambio={(mesa) => p.onEntrega({ ...p.entrega, mesa })}
            inputMode="numeric"
          />
        )}
        {mas ? (
          <div className="flex animate-entra flex-col gap-4">
            {p.origen && p.onOrigen && (
              <Grupo titulo="Origen">
                <Segmentado etiqueta="Origen" opciones={ORIGENES} valor={p.origen} onCambio={p.onOrigen} />
              </Grupo>
            )}
            <CampoTexto etiqueta="Notas del pedido" opcional valor={p.notas} onCambio={p.onNotas} />
          </div>
        ) : (
          <button type="button" onClick={() => setMasAbierto(true)} className="btn btn-fantasma btn-chico -ml-2 self-start">
            <Icono nombre="mas" className="size-4" />
            {p.origen ? 'Origen y notas' : 'Agregar una nota'}
          </button>
        )}
      </div>

      <footer className="flex flex-col gap-3 border-t border-linea px-4 pt-3 pb-4">
        {zona && (
          <div className="flex items-baseline justify-between text-sm text-tinta-2">
            <span>Envío · {zona.nombre}</span>
            <span className="num">{formatearPrecio(zona.costo_centavos)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-tinta-2">Total</span>
          <span key={total} className="num animate-aparece text-[1.75rem] leading-none font-extrabold">
            {formatearPrecio(total)}
          </span>
        </div>
        {p.error && <MensajeError>{p.error}</MensajeError>}
        <button
          type="button"
          onClick={p.onConfirmar}
          disabled={vacio || p.enviando}
          data-sonido="no"
          className="btn btn-birome btn-grande w-full"
        >
          {p.enviando ? 'Confirmando…' : 'Confirmar pedido'}
        </button>
      </footer>
    </section>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="etiqueta">{titulo}</legend>
      {children}
    </fieldset>
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
  const paso = 'grid size-8 place-items-center text-tinta-2 transition-colors hover:bg-papel hover:text-tinta disabled:text-linea-fuerte disabled:hover:bg-transparent';

  return (
    <li className="group flex animate-entra flex-col gap-2 border-b border-dashed border-linea-fuerte py-3 first:pt-1 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-linea-fuerte">
          <button type="button" className={paso} aria-label={p.cantidad === 1 ? `Quitar ${p.nombre}` : 'Uno menos'} onClick={() => p.onCantidad(p.cantidad - 1)}>
            <Icono nombre="menos" className="size-3.5" />
          </button>
          <span key={p.cantidad} className="num w-6 animate-aparece text-center text-sm font-bold">
            {p.cantidad}
          </span>
          <button type="button" className={paso} aria-label="Uno más" disabled={p.cantidad >= MAX_CANTIDAD} onClick={() => p.onCantidad(p.cantidad + 1)}>
            <Icono nombre="mas" className="size-3.5" />
          </button>
        </div>
        <span className="min-w-0 flex-1 leading-tight font-semibold">{p.nombre}</span>
        <span className="num shrink-0 text-[0.9375rem] font-semibold">{formatearPrecio(p.precio * p.cantidad)}</span>
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
          aria-label={`Nota de ${p.nombre}`}
          className="campo campo-chico border-alerta/40 bg-alerta-suave/60 text-alerta-tinta placeholder:text-alerta-tinta/50 focus:border-alerta focus:shadow-[0_0_0_3px_var(--color-alerta-suave)]"
        />
      ) : null}
      <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-60 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        {!p.notas && !editandoNota && (
          <button type="button" className="btn btn-fantasma btn-chico h-7 px-2" onClick={() => setEditandoNota(true)}>
            <Icono nombre="lapiz" className="size-3.5" />
            Nota
          </button>
        )}
        <button type="button" className="btn btn-quitar btn-chico ml-auto h-7 px-2" onClick={p.onQuitar}>
          Quitar
        </button>
      </div>
    </li>
  );
}

function CampoTexto(p: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  inputMode?: 'numeric' | 'text';
  opcional?: boolean;
}) {
  return (
    <label className="block">
      <span className="etiqueta">
        {p.etiqueta}
        {p.opcional && <span className="ml-1.5 font-normal text-tinta-3">opcional</span>}
      </span>
      <input value={p.valor} inputMode={p.inputMode} onChange={(e) => p.onCambio(e.target.value)} className="campo" />
    </label>
  );
}
