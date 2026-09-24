import type { ReactNode } from 'react';

export function Cargando() {
  return <p className="p-8 text-center text-lg text-stone-500">Cargando…</p>;
}

export function MensajeError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border-2 border-red-300 bg-red-50 p-3 font-medium text-red-800">
      {children}
    </p>
  );
}

export function PantallaMensaje({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-2xl font-bold">{titulo}</h1>
      {children}
    </main>
  );
}
