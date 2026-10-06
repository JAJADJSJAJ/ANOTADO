import { z } from 'zod';

// Horarios del local (negocios.horarios). Misma forma que valida la base en horarios.sql
// (horarios_validos): si cambia uno, cambia el otro.
//   {"vie": [["19:00", "01:30"]], "dom": [["11:30", "14:30"], ["19:00", "00:30"]]}
// Un turno cuyo cierre es menor o igual a la apertura termina al día siguiente.

export const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export type Dia = (typeof DIAS)[number];
export const MAX_TURNOS_POR_DIA = 4;

const HoraSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const TurnoSchema = z
  .tuple([HoraSchema, HoraSchema])
  .refine(([abre, cierra]) => abre !== cierra, 'La apertura y el cierre no pueden ser iguales');
export const HorariosSchema = z.partialRecord(z.enum(DIAS), z.array(TurnoSchema).max(MAX_TURNOS_POR_DIA));

export type Turno = z.infer<typeof TurnoSchema>;
export type Horarios = z.infer<typeof HorariosSchema>;

/** negocios.horarios es jsonb: se lee siempre con el schema. Mal formado = sin horarios. */
export function leerHorarios(valor: unknown): Horarios {
  const r = HorariosSchema.safeParse(valor);
  return r.success ? r.data : {};
}

export const tieneHorarios = (h: Horarios): boolean => DIAS.some((d) => (h[d]?.length ?? 0) > 0);

export type EstadoHorario =
  | { abierto: true; cierra: string }
  /** dentro: días desde hoy (0 = hoy, 1 = mañana…). null si no abre en toda la semana. */
  | { abierto: false; abre: { dia: Dia; dentro: number; hora: string } | null };

const aMinutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
const cruzaMedianoche = ([abre, cierra]: Turno) => aMinutos(cierra) <= aMinutos(abre);

/** Día de la semana y minutos desde la medianoche en la zona horaria del local. */
export function horaLocal(ahora: Date, zonaHoraria: string): { dia: Dia; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaHoraria,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const semana = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(valor('weekday'));
  return { dia: DIAS[semana === -1 ? 0 : semana]!, minutos: Number(valor('hour')) * 60 + Number(valor('minute')) };
}

/**
 * ¿Está abierto ahora? Si sí, a qué hora cierra; si no, cuándo abre. Considera los turnos del
 * día anterior que cruzan la medianoche (un viernes 19:00–01:30 sigue abierto el sábado a la 01:00).
 */
export function estadoHorario(horarios: Horarios, zonaHoraria: string, ahora: Date): EstadoHorario {
  const { dia, minutos } = horaLocal(ahora, zonaHoraria);
  const hoy = DIAS.indexOf(dia);
  const turnos = (i: number) => horarios[DIAS[(i + 7) % 7]!] ?? [];

  for (const turno of turnos(hoy)) {
    const [abre, cierra] = turno;
    const dentro = cruzaMedianoche(turno)
      ? minutos >= aMinutos(abre)
      : minutos >= aMinutos(abre) && minutos < aMinutos(cierra);
    if (dentro) return { abierto: true, cierra };
  }
  for (const turno of turnos(hoy - 1)) {
    if (cruzaMedianoche(turno) && minutos < aMinutos(turno[1])) return { abierto: true, cierra: turno[1] };
  }

  for (let dentro = 0; dentro <= 7; dentro++) {
    const aperturas = turnos(hoy + dentro)
      .map(([abre]) => abre)
      .filter((abre) => dentro > 0 || aMinutos(abre) > minutos)
      .sort();
    if (aperturas.length > 0) {
      return { abierto: false, abre: { dia: DIAS[(hoy + dentro) % 7]!, dentro, hora: aperturas[0]! } };
    }
  }
  return { abierto: false, abre: null };
}
