import { type Dia, estadoHorario, type Horarios, tieneHorarios } from '@anotado/shared';
import { useAhora } from '../hooks/useAhora.ts';

const NOMBRE_DIA: Record<Dia, string> = {
  lun: 'el lunes',
  mar: 'el martes',
  mie: 'el miércoles',
  jue: 'el jueves',
  vie: 'el viernes',
  sab: 'el sábado',
  dom: 'el domingo',
};

/**
 * Abierto o cerrado según los horarios cargados. Solo avisa: el cajero puede tomar pedidos
 * igual (preparar antes de abrir, un encargue). Sin horarios cargados no muestra nada.
 */
export function EstadoLocal({ horarios, zonaHoraria }: { horarios: Horarios; zonaHoraria: string }) {
  const ahora = useAhora(0, 30_000);
  if (!tieneHorarios(horarios)) return null;
  const estado = estadoHorario(horarios, zonaHoraria, new Date(ahora));

  if (estado.abierto) {
    return (
      <span role="status" className="chip chip-ok chip-punto">
        Abierto · cierra <span className="num">{estado.cierra}</span>
      </span>
    );
  }
  const abre = estado.abre;
  const cuando = !abre
    ? null
    : abre.dentro === 0
      ? 'abre hoy'
      : abre.dentro === 1
        ? 'abre mañana'
        : `abre ${NOMBRE_DIA[abre.dia]}`;
  return (
    <span role="status" className="chip chip-punto">
      Cerrado
      {abre && (
        <>
          {' '}
          · {cuando} <span className="num">{abre.hora}</span>
        </>
      )}
    </span>
  );
}
