import { useSyncExternalStore } from 'react';
import { cambiarSonidoInterfaz, efecto, escucharSonidoInterfaz, sonidoInterfaz } from '../lib/sonido.ts';
import { Icono } from './Icono.tsx';

/** Prende o apaga los sonidos de la interfaz (no las alarmas de la cocina). */
export function BotonSonido({ className = 'btn-fantasma' }: { className?: string }) {
  const encendido = useSyncExternalStore(escucharSonidoInterfaz, sonidoInterfaz);
  const texto = encendido ? 'Apagar los sonidos' : 'Prender los sonidos';
  return (
    <button
      type="button"
      aria-pressed={encendido}
      aria-label={texto}
      title={texto}
      data-sonido="no"
      onClick={() => {
        cambiarSonidoInterfaz(!encendido);
        if (!encendido) efecto('llave');
      }}
      className={`btn btn-icono ${className}`}
    >
      <Icono nombre={encendido ? 'sonido' : 'silencio'} />
    </button>
  );
}
