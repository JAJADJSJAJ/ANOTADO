import { formatearPrecio } from '@anotado/shared';

export function Inicio() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-50 p-4 text-neutral-900">
      <h1 className="text-4xl font-bold">Anotado</h1>
      <p className="text-lg">Los pedidos de WhatsApp, anotados solos.</p>
      <p className="text-sm text-neutral-500">Fase 0 · {formatearPrecio(28000)}</p>
    </main>
  );
}
