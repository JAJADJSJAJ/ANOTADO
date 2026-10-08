import { type ColorTemporizador, ETIQUETA_ORIGEN, type PedidoCocina, textoEntrega } from '@anotado/shared';

const BORDE: Record<ColorTemporizador, string> = {
  verde: 'border-t-ok',
  amarillo: 'border-t-alerta',
  rojo: 'border-t-peligro',
};

const TIEMPO: Record<ColorTemporizador, string> = {
  verde: 'bg-ok-suave text-ok',
  amarillo: 'bg-alerta-suave text-alerta-tinta',
  rojo: 'bg-peligro text-white',
};

const BOTON: Partial<Record<PedidoCocina['estado'], { texto: string; clase: string }>> = {
  pendiente: { texto: 'Empezar', clase: 'btn-birome' },
  en_cocina: { texto: 'Listo', clase: 'btn-tinta' },
  listo: { texto: 'Entregado', clase: 'btn-tinta' },
};

/**
 * Un pedido en la cocina, como el ticket que sale de la impresora: número gigante, items y
 * notas grandes, un solo botón. `sellado` = se tocó Listo (cae el sello); `saliendo` = se va.
 */
export function TarjetaCocina({
  pedido,
  minutos,
  color,
  puedeAvanzar,
  ocupado,
  nuevo,
  sellado = false,
  saliendo = false,
  ancho = true,
  onAvanzar,
}: {
  pedido: PedidoCocina;
  minutos: number;
  color: ColorTemporizador;
  puedeAvanzar: boolean;
  ocupado: boolean;
  nuevo: boolean;
  sellado?: boolean;
  saliendo?: boolean;
  /** Ancho fijo (riel horizontal); si no, ocupa la columna. */
  ancho?: boolean;
  onAvanzar: () => void;
}) {
  const boton = BOTON[pedido.estado];
  const enCocina = pedido.estado === 'en_cocina';

  return (
    <article
      aria-label={`Pedido ${pedido.numero}`}
      className={`relative shrink-0 transition-[opacity,translate] duration-300 ease-salida ${ancho ? 'w-[19rem] sm:w-[20.5rem]' : 'w-full'} ${
        saliendo ? 'translate-x-10 opacity-0' : ''
      } ${nuevo ? 'animate-imprimir' : ''}`}
    >
      <div className={`ticket flex h-full flex-col border-t-4 ${BORDE[color]}`}>
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <p className="num text-[3.25rem] leading-[0.9] font-extrabold tracking-[-0.05em]">#{pedido.numero}</p>
            <p className="num mt-2 text-xs font-semibold tracking-[0.04em] text-tinta-2 uppercase">
              {textoEntrega(pedido)} · {ETIQUETA_ORIGEN[pedido.origen]}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`num flex items-center gap-1.5 rounded-md px-2 py-1 text-base font-extrabold ${TIEMPO[color]}`}>
              {color === 'rojo' && <span aria-hidden className="size-1.5 animate-latido rounded-full bg-white" />}
              {minutos} min
            </span>
            <span className={`num rounded-[5px] px-1.5 py-1 text-[0.6875rem] font-bold tracking-[0.08em] uppercase ${enCocina ? 'bg-birome-suave text-birome' : 'bg-papel text-tinta-2'}`}>
              {enCocina ? 'En preparación' : 'Nuevo'}
            </span>
          </div>
        </header>

        <hr className="mx-5 mt-3.5 border-t border-dashed border-linea-fuerte" />

        <ul className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-3.5">
          {pedido.items.map((item, i) => (
            <li key={`${item.nombre}-${i}`} className="text-[1.375rem] leading-tight font-bold tracking-[-0.01em]">
              <span className="num mr-2.5 inline-block min-w-[1.4ch] font-extrabold">{item.cantidad}</span>
              {item.nombre}
              {item.notas && (
                <span className="mt-1 ml-[calc(1.4ch+0.625rem)] block text-lg leading-snug font-semibold text-alerta-tinta">
                  — {item.notas}
                </span>
              )}
            </li>
          ))}
        </ul>

        {pedido.notas && (
          <p className="mx-5 mb-3 rounded-lg border border-dashed border-tinta-3 px-3 py-2 text-[1.0625rem] leading-snug font-semibold">
            <span className="rotulo mb-1 block">Nota</span>
            {pedido.notas}
          </p>
        )}

        {boton && puedeAvanzar && (
          <div className="px-3 pt-1">
            <button
              type="button"
              disabled={ocupado || sellado}
              onClick={onAvanzar}
              data-sonido={pedido.estado === 'en_cocina' ? 'no' : undefined}
              className={`btn btn-grande h-16 w-full text-2xl font-extrabold ${boton.clase}`}
            >
              {ocupado && !sellado ? '…' : boton.texto}
            </button>
          </div>
        )}
      </div>

      {sellado && (
        <span
          aria-hidden
          className="num pointer-events-none absolute top-14 right-5 animate-sellar rounded-md border-[3px] border-ok px-3 pt-1.5 pb-1 text-3xl font-extrabold tracking-[0.06em] text-ok mix-blend-multiply"
        >
          LISTO
        </span>
      )}
    </article>
  );
}
