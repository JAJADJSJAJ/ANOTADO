import { DIAS, type Dia, type Horarios, MAX_TURNOS_POR_DIA, type Turno } from '@anotado/shared';

const NOMBRE: Record<Dia, string> = {
  lun: 'Lunes',
  mar: 'Martes',
  mie: 'Miércoles',
  jue: 'Jueves',
  vie: 'Viernes',
  sab: 'Sábado',
  dom: 'Domingo',
};

const TURNO_NUEVO: Turno = ['19:00', '23:30'];

/**
 * Turnos por día. Un turno que cierra antes de abrir termina al día siguiente (19:00 a 01:30).
 * Lo valida HorariosSchema al guardar y la base (horarios_validos).
 */
export function EditorHorarios({ valor, onCambio }: { valor: Horarios; onCambio: (h: Horarios) => void }) {
  const cambiarDia = (dia: Dia, turnos: Turno[]) => onCambio({ ...valor, [dia]: turnos });

  return (
    <ul className="flex flex-col divide-y divide-stone-200">
      {DIAS.map((dia) => {
        const turnos = valor[dia] ?? [];
        return (
          <li key={dia} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
            <span className="w-24 pt-2 font-bold">{NOMBRE[dia]}</span>
            <div className="flex flex-1 flex-col gap-2">
              {turnos.length === 0 && <span className="pt-2 text-stone-500">Cerrado</span>}
              {turnos.map(([abre, cierra], i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    value={abre}
                    aria-label={`${NOMBRE[dia]}: abre`}
                    onChange={(e) => cambiarDia(dia, turnos.map((t, j) => (j === i ? [e.target.value, t[1]] : t)))}
                    className="rounded-lg border-2 border-stone-300 px-2 py-1 text-lg"
                  />
                  a
                  <input
                    type="time"
                    value={cierra}
                    aria-label={`${NOMBRE[dia]}: cierra`}
                    onChange={(e) => cambiarDia(dia, turnos.map((t, j) => (j === i ? [t[0], e.target.value] : t)))}
                    className="rounded-lg border-2 border-stone-300 px-2 py-1 text-lg"
                  />
                  {cierra <= abre && cierra !== abre && <span className="text-sm text-stone-500">(del día siguiente)</span>}
                  <button
                    type="button"
                    className="text-sm font-medium text-red-700 underline"
                    onClick={() => cambiarDia(dia, turnos.filter((_, j) => j !== i))}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
            {turnos.length < MAX_TURNOS_POR_DIA && (
              <button
                type="button"
                className="pt-2 text-sm font-medium underline"
                onClick={() => cambiarDia(dia, [...turnos, turnos.length === 0 ? TURNO_NUEVO : ['12:00', '15:00']])}
              >
                + Turno
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
