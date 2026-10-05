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
      <p role="status" className="flex items-center gap-2 font-bold text-emerald-800">
        <span aria-hidden className="size-3 rounded-full bg-emerald-500" />
        Abierto · cierra {estado.cierra}
      </p>
    );
  }
  const abre = estado.abre;
  const cuando = !abre
    ? ''
    : abre.dentro === 0
      ? ` · abre hoy ${abre.hora}`
      : abre.dentro === 1
        ? ` · abre mañana ${abre.hora}`
        : ` · abre ${NOMBRE_DIA[abre.dia]} ${abre.hora}`;
  return (
    <p role="status" className="flex items-center gap-2 font-bold text-stone-600">
      <span aria-hidden className="size-3 rounded-full bg-stone-400" />
      Cerrado{cuando}
    </p>
  );
}
