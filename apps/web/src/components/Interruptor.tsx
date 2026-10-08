/** Interruptor de prendido/apagado (role="switch"). La perilla se desliza con un rebote corto. */
export function Interruptor({
  prendido,
  onCambio,
  etiqueta,
  disabled = false,
}: {
  prendido: boolean;
  onCambio: (v: boolean) => void;
  etiqueta: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={prendido}
      aria-label={etiqueta}
      disabled={disabled}
      data-sonido="llave"
      onClick={() => onCambio(!prendido)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-50 ${
        prendido ? 'border-tinta bg-tinta' : 'border-linea-fuerte bg-papel'
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0.5 size-[18px] rounded-full shadow-[0_1px_2px_rgb(20_20_18/0.25)] transition-transform duration-300 ease-resorte ${
          prendido ? 'translate-x-4 bg-white' : 'translate-x-0 bg-hoja'
        }`}
      />
    </button>
  );
}
