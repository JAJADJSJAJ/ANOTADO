import { Icono } from './Icono.tsx';

export type Aviso = {
  id: number;
  tipo: 'info' | 'ok' | 'error' | 'cancelado' | 'deshacer';
  texto: string;
  /** Avisos con la misma clave se reemplazan en vez de apilarse. */
  clave?: string;
  /** Solo para tipo 'deshacer'. */
  deshacer?: () => void;
  /** Animando la salida: en un momento desaparece. */
  saliendo?: boolean;
};

const PUNTO: Record<Aviso['tipo'], string> = {
  info: 'bg-noche-tinta-2',
  ok: 'bg-noche-ok',
  error: 'bg-peligro',
  cancelado: 'bg-peligro',
  deshacer: 'bg-noche-ok',
};

/**
 * Avisos flotantes abajo al centro, en tinta negra. Con `enLinea`, solo el último y sin
 * flotar: la cocina los muestra en su barra de abajo para no tapar los botones de los tickets.
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
          : 'pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4'
      }
    >
      {visibles.map((a) => (
        <div
          key={a.id}
          role={a.tipo === 'error' || a.tipo === 'cancelado' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl border border-white/10 py-2 pr-2 pl-4 text-[0.9375rem] font-medium text-white shadow-alta transition duration-200 ease-salida starting:translate-y-3 starting:scale-95 starting:opacity-0 ${
            a.saliendo ? 'translate-y-2 opacity-0' : ''
          } ${a.tipo === 'cancelado' ? 'bg-peligro' : 'bg-tinta'}`}
        >
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${a.tipo === 'cancelado' ? 'bg-white' : PUNTO[a.tipo]}`} />
          <span className="py-1">{a.texto}</span>
          {a.deshacer && (
            <button
              type="button"
              onClick={() => {
                a.deshacer?.();
                onCerrar(a.id);
              }}
              className="h-8 rounded-lg bg-white/10 px-3 text-sm font-semibold transition-colors hover:bg-white/20"
            >
              Deshacer
            </button>
          )}
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => onCerrar(a.id)}
            className="grid size-8 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Icono nombre="cerrar" className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
