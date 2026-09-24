import {
  type ColorTemporizador,
  ETIQUETA_ORIGEN,
  type PedidoCocina,
  textoEntrega,
} from '@anotado/shared';

const TEMPORIZADOR: Record<ColorTemporizador, string> = {
  verde: 'bg-emerald-500 text-white',
  amarillo: 'bg-amber-400 text-stone-950',
  rojo: 'bg-red-600 text-white animate-pulse',
};

const BORDE: Record<ColorTemporizador, string> = {
  verde: 'border-emerald-500',
  amarillo: 'border-amber-400',
  rojo: 'border-red-600',
};

const BOTON: Partial<Record<PedidoCocina['estado'], { texto: string; clase: string }>> = {
  pendiente: { texto: 'Empezar', clase: 'bg-sky-600 active:bg-sky-700' },
  en_cocina: { texto: '¡Listo!', clase: 'bg-emerald-600 active:bg-emerald-700' },
  listo: { texto: 'Entregado', clase: 'bg-indigo-600 active:bg-indigo-700' },
};

/** Tarjeta de un pedido en la cocina: número gigante, items y notas grandes, un solo botón. */
export function TarjetaCocina({
  pedido,
  minutos,
  color,
  puedeAvanzar,
  ocupado,
  nuevo,
  onAvanzar,
}: {
  pedido: PedidoCocina;
  minutos: number;
  color: ColorTemporizador;
  puedeAvanzar: boolean;
  ocupado: boolean;
  nuevo: boolean;
  onAvanzar: () => void;
}) {
  const boton = BOTON[pedido.estado];
  const enCocina = pedido.estado === 'en_cocina';

  return (
    <article
      aria-label={`Pedido ${pedido.numero}`}
      className={`flex w-[19rem] shrink-0 flex-col overflow-hidden rounded-3xl border-t-8 text-stone-900 shadow-xl sm:w-[21rem] ${
        enCocina ? 'bg-sky-50' : 'bg-stone-50'
      } ${BORDE[color]} ${
        nuevo ? 'animate-[llegada_1s_ease-in-out_3]' : ''
      }`}
    >
      <header className="flex items-start justify-between gap-2 px-5 pt-4">
        <div>
          <p className="text-6xl leading-none font-black tracking-tight">#{pedido.numero}</p>
          <p className="mt-2 text-base font-semibold text-stone-600">
            {textoEntrega(pedido)} · {ETIQUETA_ORIGEN[pedido.origen]}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded-full px-3 py-1 text-xl font-black tabular-nums ${TEMPORIZADOR[color]}`}>
            {minutos} min
          </span>
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold uppercase ${
              enCocina ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-900'
            }`}
          >
            {enCocina ? 'En preparación' : 'Nuevo'}
          </span>
        </div>
      </header>

      <ul className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {pedido.items.map((item, i) => (
          <li key={`${item.nombre}-${i}`}>
            <p className="text-2xl leading-tight font-bold">
              <span className="mr-2 inline-block min-w-[2.2ch] rounded-lg bg-stone-900 px-1.5 text-center text-white">
                {item.cantidad}
              </span>
              {item.nombre}
            </p>
            {item.notas && (
              <p className="mt-1 ml-1 rounded-lg bg-amber-100 px-2 py-1 text-xl font-semibold text-amber-950">
                ⚠ {item.notas}
              </p>
            )}
          </li>
        ))}
      </ul>

      {pedido.notas && (
        <p className="mx-5 mb-3 rounded-xl border-2 border-dashed border-stone-400 px-3 py-2 text-lg font-semibold">
          Nota: {pedido.notas}
        </p>
      )}

      {boton && puedeAvanzar && (
        <button
          type="button"
          disabled={ocupado}
          onClick={onAvanzar}
          className={`m-3 mt-0 rounded-2xl py-5 text-3xl font-black text-white transition disabled:opacity-60 ${boton.clase}`}
        >
          {ocupado ? '…' : boton.texto}
        </button>
      )}
    </article>
  );
}
