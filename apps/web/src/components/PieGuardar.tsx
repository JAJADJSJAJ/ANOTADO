import { useEffect } from 'react';
import { efecto } from '../lib/sonido.ts';
import { Icono } from './Icono.tsx';

/**
 * Pie de un formulario de ajustes: el botón se prende solo si hay cambios y, al guardar,
 * aparece "Guardado" con un tilde un par de segundos.
 */
export function PieGuardar({
  cambios,
  guardando,
  guardadoEn,
  onGuardar,
  onDescartar,
}: {
  cambios: boolean;
  guardando: boolean;
  /** Momento del último guardado bien hecho (cambia → se muestra el tilde). */
  guardadoEn: number | null;
  onGuardar: () => void;
  onDescartar?: () => void;
}) {
  useEffect(() => {
    if (guardadoEn) efecto('ok');
  }, [guardadoEn]);

  return (
    <div className="flex items-center justify-end gap-3">
      {guardadoEn && !cambios && (
        // Aparece, queda un momento y se desvanece sola (animación con fill forwards).
        <span key={guardadoEn} role="status" className="flex animate-guardado items-center gap-1.5 text-sm font-semibold text-ok">
          <Icono nombre="check" className="size-4" />
          Guardado
        </span>
      )}
      {cambios && onDescartar && (
        <button type="button" onClick={onDescartar} className="btn btn-fantasma">
          Descartar cambios
        </button>
      )}
      <button type="button" disabled={!cambios || guardando} onClick={onGuardar} className="btn btn-tinta" data-sonido="no">
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  );
}
