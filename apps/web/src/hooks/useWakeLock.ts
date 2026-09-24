import { useEffect, useState } from 'react';

export type EstadoWakeLock = 'inactivo' | 'activo' | 'no_soportado' | 'error';

/**
 * Mantiene la pantalla encendida mientras `activo`. El navegador lo suelta al cambiar de
 * pestaña o apagar la pantalla: al volver se pide de nuevo. Tablets viejas pueden no
 * soportarlo: se avisa en pantalla para configurar la tablet a mano.
 */
export function useWakeLock(activo: boolean): EstadoWakeLock {
  const soportado = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [estado, setEstado] = useState<EstadoWakeLock>(soportado ? 'inactivo' : 'no_soportado');

  useEffect(() => {
    if (!activo || !soportado) return;
    let lock: WakeLockSentinel | null = null;
    let cancelado = false;

    const pedir = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelado) return void lock.release();
        setEstado('activo');
        lock.addEventListener('release', () => {
          if (!cancelado) setEstado('inactivo');
        });
      } catch {
        if (!cancelado) setEstado('error');
      }
    };

    void pedir();
    const alVolver = () => void pedir();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      cancelado = true;
      document.removeEventListener('visibilitychange', alVolver);
      void lock?.release();
    };
  }, [activo, soportado]);

  return estado;
}
