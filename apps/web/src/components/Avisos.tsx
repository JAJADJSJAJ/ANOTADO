export type Aviso = {
  id: number;
  tipo: 'info' | 'error' | 'cancelado' | 'deshacer';
  texto: string;
  /** Avisos con la misma clave se reemplazan en vez de apilarse. */
  clave?: string;
  /** Solo para tipo 'deshacer'. */
  deshacer?: () => void;
};

const ESTILO: Record<Aviso['tipo'], string> = {
  info: 'bg-stone-800 text-white',
  error: 'bg-red-700 text-white',
  cancelado: 'bg-red-600 text-white ring-4 ring-red-300',
  deshacer: 'bg-stone-800 text-white',
};

/**
 * Avisos flotantes abajo al centro. Con `enLinea`, solo el último y sin flotar: la cocina
 * los muestra en su barra de abajo para no tapar los botones de las tarjetas.
 */
export function ListaAvisos({
  avisos,
  onCerrar,
  enLinea = false,
}: {
  avisos: Aviso[];
  onCerrar: (id: number) => void;
  enLinea?: boolean;
}) {
  if (avisos.length === 0) return null;
  const visibles = enLinea ? avisos.slice(-1) : avisos;
  return (
    <div
      aria-live="polite"
      className={
        enLinea
          ? 'flex justify-end'
          : 'pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4'
      }
    >
      {visibles.map((a) => (
        <div
          key={a.id}
          role={a.tipo === 'error' || a.tipo === 'cancelado' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-xl items-center gap-4 rounded-2xl px-5 py-4 text-lg font-bold shadow-2xl ${ESTILO[a.tipo]}`}
        >
          <span>{a.texto}</span>
          {a.deshacer && (
            <button
              type="button"
              onClick={() => {
                a.deshacer?.();
                onCerrar(a.id);
              }}
              className="rounded-xl bg-white px-4 py-2 text-stone-900 active:bg-stone-200"
            >
              Deshacer
            </button>
          )}
          <button type="button" aria-label="Cerrar aviso" onClick={() => onCerrar(a.id)} className="ml-auto px-2 text-2xl leading-none opacity-70">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
