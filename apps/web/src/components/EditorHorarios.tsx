import { DIAS, type Dia, type Horarios, MAX_TURNOS_POR_DIA, type Turno } from '@anotado/shared';
import { Icono } from './Icono.tsx';

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
    <ul className="-my-2 divide-y divide-linea">
      {DIAS.map((dia) => {
        const turnos = valor[dia] ?? [];
        return (
          <li key={dia} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
            <span className={`w-24 pt-2 text-[0.9375rem] font-semibold ${turnos.length ? '' : 'text-tinta-3'}`}>{NOMBRE[dia]}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {turnos.length === 0 && <span className="pt-2 text-[0.9375rem] text-tinta-3">Cerrado</span>}
              {turnos.map(([abre, cierra], i) => (
                <div key={i} className="flex animate-entra flex-wrap items-center gap-2">
                  <input
                    type="time"
                    value={abre}
                    aria-label={`${NOMBRE[dia]}: abre`}
                    onChange={(e) => cambiarDia(dia, turnos.map((t, j) => (j === i ? [e.target.value, t[1]] : t)))}
                    className="campo campo-chico num w-[7.5rem]"
                  />
                  <span className="text-tinta-3">a</span>
                  <input
                    type="time"
                    value={cierra}
                    aria-label={`${NOMBRE[dia]}: cierra`}
                    onChange={(e) => cambiarDia(dia, turnos.map((t, j) => (j === i ? [t[0], e.target.value] : t)))}
                    className="campo campo-chico num w-[7.5rem]"
                  />
                  {cierra < abre && <span className="chip">al otro día</span>}
                  <button
                    type="button"
                    aria-label={`Quitar el turno de ${abre} a ${cierra}`}
                    title="Quitar turno"
                    className="btn btn-quitar btn-icono size-9"
                    onClick={() => cambiarDia(dia, turnos.filter((_, j) => j !== i))}
                  >
                    <Icono nombre="cerrar" className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            {turnos.length < MAX_TURNOS_POR_DIA && (
              <button
                type="button"
                className="btn btn-fantasma btn-chico mt-0.5"
                onClick={() => cambiarDia(dia, [...turnos, turnos.length === 0 ? TURNO_NUEVO : ['12:00', '15:00']])}
              >
                <Icono nombre="mas" className="size-4" />
                Turno
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
