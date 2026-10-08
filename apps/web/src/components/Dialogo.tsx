import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { DialogosContext, type Pregunta } from '../lib/dialogos.ts';
import { efecto } from '../lib/sonido.ts';
import { Icono } from './Icono.tsx';

/**
 * Diálogo modal con <dialog> del navegador: atrapa el foco, Esc cierra y el resto de la
 * página queda inerte. Se monta abierto; el padre lo desmonta en onCerrar.
 */
export function Dialogo({
  titulo,
  descripcion,
  onCerrar,
  children,
  ancho = 'max-w-md',
  oscuro = false,
}: {
  titulo: string;
  descripcion?: ReactNode;
  onCerrar: () => void;
  children?: ReactNode;
  ancho?: string;
  oscuro?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    cerrar.current = onCerrar;
  });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    d.showModal();
    efecto('abrir');
    const alCancelar = (e: Event) => {
      e.preventDefault();
      cerrar.current();
    };
    d.addEventListener('cancel', alCancelar);
    return () => {
      d.removeEventListener('cancel', alCancelar);
      d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={titulo}
      // Click en el fondo (fuera de la caja) cierra.
      onMouseDown={(e) => e.target === ref.current && onCerrar()}
      className={`m-auto w-[calc(100%-2rem)] ${ancho} animate-entra rounded-2xl border p-0 shadow-alta backdrop:animate-aparece ${
        oscuro ? 'border-noche-linea bg-noche-2 text-noche-tinta' : 'border-linea bg-hoja text-tinta'
      }`}
    >
      <div className="flex flex-col gap-5 p-6">
        <header className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl leading-tight font-bold tracking-[-0.01em]">{titulo}</h2>
            {descripcion && <div className={`mt-1.5 text-[0.9375rem] ${oscuro ? 'text-noche-tinta-2' : 'text-tinta-2'}`}>{descripcion}</div>}
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className={`btn btn-icono -mt-1 -mr-2 ${oscuro ? 'btn-noche border-transparent bg-transparent' : 'btn-fantasma'}`}>
            <Icono nombre="cerrar" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

type Abierta = Pregunta & { id: number; responder: (r: string | null) => void };

let siguienteId = 0;

/** Da usePreguntar() a toda la app: un solo diálogo de confirmación a la vez. */
export function DialogosProvider({ children }: { children: ReactNode }) {
  const [abierta, setAbierta] = useState<Abierta | null>(null);
  const actual = useRef<Abierta | null>(null);

  const preguntar = useCallback(
    (p: Pregunta) =>
      new Promise<string | null>((responder) => {
        // Si había otra pregunta abierta, queda como cancelada.
        actual.current?.responder(null);
        actual.current = { ...p, id: ++siguienteId, responder };
        setAbierta(actual.current);
      }),
    [],
  );

  return (
    <DialogosContext value={preguntar}>
      {children}
      {abierta && (
        <Confirmacion
          key={abierta.id}
          pregunta={abierta}
          onResponder={(r) => {
            abierta.responder(r);
            actual.current = null;
            setAbierta(null);
          }}
        />
      )}
    </DialogosContext>
  );
}

function Confirmacion({ pregunta, onResponder }: { pregunta: Pregunta; onResponder: (r: string | null) => void }) {
  const [valor, setValor] = useState(pregunta.campo?.inicial ?? '');

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pregunta.peligro) efecto('descartar');
    onResponder(pregunta.campo ? valor : '');
  }

  return (
    <Dialogo titulo={pregunta.titulo} descripcion={pregunta.texto} onCerrar={() => onResponder(null)}>
      <form onSubmit={enviar} className="flex flex-col gap-5">
        {pregunta.campo && (
          <label className="block">
            <span className="etiqueta">{pregunta.campo.etiqueta}</span>
            <input
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={pregunta.campo.placeholder}
              maxLength={pregunta.campo.maxLength}
              className="campo"
            />
            {pregunta.campo.ayuda && <span className="mt-1.5 block text-sm text-tinta-3">{pregunta.campo.ayuda}</span>}
          </label>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => onResponder(null)} className="btn">
            Volver
          </button>
          <button
            type="submit"
            autoFocus={!pregunta.campo}
            data-sonido={pregunta.peligro ? 'no' : undefined}
            className={`btn ${pregunta.peligro ? 'btn-peligro' : 'btn-tinta'}`}
          >
            {pregunta.aceptar}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
