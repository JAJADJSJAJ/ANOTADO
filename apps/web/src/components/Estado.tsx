import type { ReactNode } from 'react';
import { Icono, type NombreIcono } from './Icono.tsx';
import { Logo } from './Marca.tsx';

/** Barra fina que corre: se ve que algo pasa sin tapar la pantalla con un spinner. */
export function Cargando() {
  return (
    <div role="status" aria-label="Cargando" className="flex flex-1 items-center justify-center p-10">
      <span className="relative block h-0.5 w-24 overflow-hidden rounded-full bg-linea">
        <span className="absolute inset-y-0 left-0 w-2/5 animate-carga rounded-full bg-tinta" />
      </span>
    </div>
  );
}

type Tono = 'info' | 'ok' | 'alerta' | 'peligro';

const TONO: Record<Tono, { caja: string; icono: NombreIcono; color: string }> = {
  info: { caja: 'border-linea bg-hoja text-tinta-2', icono: 'info', color: 'text-tinta-3' },
  ok: { caja: 'border-ok/25 bg-ok-suave text-tinta', icono: 'check', color: 'text-ok' },
  alerta: { caja: 'border-alerta/30 bg-alerta-suave text-tinta', icono: 'alerta', color: 'text-alerta' },
  peligro: { caja: 'border-peligro/25 bg-peligro-suave text-tinta', icono: 'alerta', color: 'text-peligro' },
};

/** Aviso dentro de la página (no flota): un ícono, el texto y, opcional, una acción. */
export function Nota({
  tono = 'info',
  children,
  accion,
  className = '',
  rol,
}: {
  tono?: Tono;
  children: ReactNode;
  accion?: ReactNode;
  className?: string;
  rol?: 'alert' | 'status';
}) {
  const t = TONO[tono];
  return (
    <div role={rol} className={`flex animate-entra items-start gap-3 rounded-xl border px-3.5 py-3 text-[0.9375rem] leading-snug ${t.caja} ${className}`}>
      <Icono nombre={t.icono} className={`mt-px size-[18px] ${t.color}`} />
      <div className="min-w-0 flex-1">{children}</div>
      {accion}
    </div>
  );
}

export function MensajeError({ children }: { children: ReactNode }) {
  return (
    <Nota tono="peligro" rol="alert">
      {children}
    </Nota>
  );
}

/** Pantalla de una sola cosa (no encontrada, sin acceso, error de carga). */
export function PantallaMensaje({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo className="mb-2 size-10" />
      <h1 className="text-2xl font-bold tracking-[-0.02em]">{titulo}</h1>
      {children}
    </main>
  );
}

/** Lugar vacío: un ícono gris, un título corto y una línea que explica qué va a aparecer. */
export function Vacio({
  icono = 'ticket',
  titulo,
  children,
  className = '',
}: {
  icono?: NombreIcono;
  titulo: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`m-auto flex max-w-xs animate-aparece flex-col items-center gap-2 p-6 text-center ${className}`}>
      <Icono nombre={icono} className="mb-1 size-9 stroke-[1.4] text-linea-fuerte" />
      <p className="font-semibold text-tinta">{titulo}</p>
      {children && <p className="text-sm text-tinta-3">{children}</p>}
    </div>
  );
}
