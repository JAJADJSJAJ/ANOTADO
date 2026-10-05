import { describe, expect, it } from 'vitest';
import { estadoHorario, type Horarios, HorariosSchema, horaLocal, leerHorarios, tieneHorarios } from '../src/index.ts';

const MVD = 'America/Montevideo'; // UTC-3, sin horario de verano
/** Hora local de Montevideo → Date. El 2026-10-05 es lunes. */
const montevideo = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-03:00`);

const ceibo: Horarios = {
  mar: [['19:00', '00:30']],
  vie: [['19:00', '01:30']],
  sab: [['19:00', '01:30']],
  dom: [['11:30', '14:30'], ['19:00', '00:30']],
};

describe('horaLocal', () => {
  it('usa la zona del local, no la del equipo', () => {
    expect(horaLocal(new Date('2026-10-06T02:15:00Z'), MVD)).toEqual({ dia: 'lun', minutos: 23 * 60 + 15 });
  });
  it('medianoche es 00:00, no 24:00', () => {
    expect(horaLocal(montevideo('2026-10-06', '00:00'), MVD)).toEqual({ dia: 'mar', minutos: 0 });
  });
});

describe('estadoHorario', () => {
  it('abierto dentro de un turno', () => {
    expect(estadoHorario(ceibo, MVD, montevideo('2026-10-11', '12:00'))).toEqual({ abierto: true, cierra: '14:30' });
  });

  it('el turno del viernes sigue abierto el sábado de madrugada', () => {
    expect(estadoHorario(ceibo, MVD, montevideo('2026-10-10', '01:00'))).toEqual({ abierto: true, cierra: '01:30' });
  });

  it('el cierre es exclusivo', () => {
    expect(estadoHorario(ceibo, MVD, montevideo('2026-10-10', '01:30'))).toMatchObject({ abierto: false });
  });

  it('cerrado entre turnos: abre hoy más tarde', () => {
    expect(estadoHorario(ceibo, MVD, montevideo('2026-10-11', '16:00'))).toEqual({
      abierto: false,
      abre: { dia: 'dom', dentro: 0, hora: '19:00' },
    });
  });

  it('cerrado el lunes: abre el martes', () => {
    expect(estadoHorario(ceibo, MVD, montevideo('2026-10-05', '20:00'))).toEqual({
      abierto: false,
      abre: { dia: 'mar', dentro: 1, hora: '19:00' },
    });
  });

  it('después de cerrar, la próxima apertura puede ser la semana que viene', () => {
    const soloMartes: Horarios = { mar: [['19:00', '23:00']] };
    expect(estadoHorario(soloMartes, MVD, montevideo('2026-10-06', '23:30'))).toEqual({
      abierto: false,
      abre: { dia: 'mar', dentro: 7, hora: '19:00' },
    });
  });

  it('un turno que cierra a las 00:00 termina a medianoche', () => {
    const h: Horarios = { vie: [['20:00', '00:00']] };
    expect(estadoHorario(h, MVD, montevideo('2026-10-09', '23:59'))).toEqual({ abierto: true, cierra: '00:00' });
    expect(estadoHorario(h, MVD, montevideo('2026-10-10', '00:00'))).toMatchObject({ abierto: false });
  });

  it('sin horarios no abre nunca', () => {
    expect(estadoHorario({}, MVD, montevideo('2026-10-05', '20:00'))).toEqual({ abierto: false, abre: null });
  });
});

describe('HorariosSchema', () => {
  it('acepta la forma de la base', () => {
    expect(HorariosSchema.safeParse(ceibo).success).toBe(true);
    expect(HorariosSchema.safeParse({}).success).toBe(true);
  });

  it.each([
    ['día desconocido', { lunes: [] }],
    ['24:00', { lun: [['19:00', '24:00']] }],
    ['sin cero adelante', { lun: [['9:00', '13:00']] }],
    ['apertura igual a cierre', { lun: [['19:00', '19:00']] }],
    ['más de 4 turnos', { lun: Array.from({ length: 5 }, (_, i) => [`0${i}:00`, `0${i}:30`]) }],
  ])('rechaza %s', (_, valor) => {
    expect(HorariosSchema.safeParse(valor).success).toBe(false);
  });

  it('leerHorarios tolera basura', () => {
    expect(leerHorarios('no')).toEqual({});
    expect(tieneHorarios(leerHorarios({ lun: [] }))).toBe(false);
    expect(tieneHorarios(ceibo)).toBe(true);
  });
});
