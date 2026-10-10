import { createContext, useContext } from 'react';

/** Pregunta de sí o no, en lugar del confirm() del navegador. */
export type Pregunta = {
  titulo: string;
  texto?: string;
  /** Texto del botón que confirma ("Borrar", "Suspender"). */
  aceptar: string;
  /** Acción que no se deshace: el botón va en rojo. */
  peligro?: boolean;
  /** Si viene, se pide un dato (en lugar del prompt() del navegador). */
  campo?: { etiqueta: string; inicial?: string; placeholder?: string; maxLength?: number; ayuda?: string };
};

/** null = la persona canceló. Sin campo, '' = aceptó. */
export type Preguntar = (p: Pregunta) => Promise<string | null>;

export const DialogosContext = createContext<Preguntar | null>(null);

/** const preguntar = usePreguntar(); if ((await preguntar({...})) === null) return; */
export function usePreguntar(): Preguntar {
  const preguntar = useContext(DialogosContext);
  if (!preguntar) throw new Error('usePreguntar fuera de DialogosProvider');
  return preguntar;
}
