import { describe, expect, it } from 'vitest';
import {
  aConfigGuardada,
  CONFIG_AUTO_DEFECTO,
  type DatosRespuesta,
  esAfirmacion,
  leerConfigAuto,
  motivoManual,
  type ProductoMenu,
  respuestaBot,
} from '../src/index.ts';

const COMPLETA = '11111111-1111-4111-8111-111111111111';
const menu: ProductoMenu[] = [{ id: COMPLETA, ref: 'p1', nombre: 'Hamburguesa completa', activo: true }];
const armado = { items: [{ producto_id: COMPLETA, cantidad: 2 }], entrega: { modo: 'retiro' as const } };
const datos = (extra: Partial<DatosRespuesta> = {}): DatosRespuesta => ({
  negocio: 'El Ceibo',
  borrador: armado,
  menu,
  preguntas: [],
  dudosos: [],
  errores: 0,
  cambio: false,
  primera: false,
  listo: true,
  ...extra,
});

describe('esAfirmacion', () => {
  it('reconoce un sí corto, con o sin tildes y agradecimientos', () => {
    for (const t of ['sí', 'Si!!', 'dale', 'ok gracias', 'sí, confirmalo', 'de una', 'perfecto', 'siii dale', 'está bien']) {
      expect(esAfirmacion(t), t).toBe(true);
    }
  });

  it('no confunde un sí con un cambio, una pregunta o un no', () => {
    for (const t of ['si pero sacame una', 'no', 'mejor no', 'sí, agregame una coca', '¿cuánto sale?', 'sisisisisisisisisisisisisisisisisisisisisisisisi algo']) {
      expect(esAfirmacion(t), t).toBe(false);
    }
  });
});

describe('leerConfigAuto', () => {
  it('sin config, apagada con los valores por defecto', () => {
    expect(leerConfigAuto(null)).toEqual(CONFIG_AUTO_DEFECTO);
    expect(leerConfigAuto({ auto: { activa: true } })).toEqual({ ...CONFIG_AUTO_DEFECTO, activa: true });
  });

  it('ida y vuelta con lo que se guarda', () => {
    const c = { ...CONFIG_AUTO_DEFECTO, activa: true, maxPorProducto: 4 };
    expect(leerConfigAuto({ auto: aConfigGuardada(c) })).toEqual(c);
  });

  it('valores fuera de rango: los de por defecto', () => {
    expect(leerConfigAuto({ auto: { max_por_producto: 500 } })).toEqual(CONFIG_AUTO_DEFECTO);
  });
});

describe('respuestas de la confirmación automática', () => {
  it('pregunta con el resumen y el total', () => {
    expect(respuestaBot(datos({ confirmacion: { tipo: 'pregunta', total: 64000 } }))).toBe(
      'Tu pedido: 2 Hamburguesa completa, para retirar.\nTotal: $ 640. ¿Lo confirmo? Respondé SÍ.',
    );
  });

  it('si se terminó algo, lo dice y ofrece cambiar', () => {
    expect(respuestaBot(datos({ confirmacion: { tipo: 'sin_stock', detalle: 'Se terminó Hamburguesa completa' } }))).toBe(
      'Perdón: se terminó Hamburguesa completa. ¿Querés cambiarlo por otra cosa?',
    );
  });

  it('si todavía quedan algunas, ofrece cambiar la cantidad', () => {
    expect(respuestaBot(datos({ confirmacion: { tipo: 'sin_stock', detalle: 'De Hamburguesa completa quedan 1' } }))).toBe(
      'Perdón: de Hamburguesa completa quedan 1. ¿Querés cambiar la cantidad o pedir otra cosa?',
    );
  });

  it('si algo del pedido se agotó mientras tanto, se lo dice', () => {
    expect(
      respuestaBot(datos({ borrador: { items: [], entrega: { modo: 'retiro' } }, listo: true, seTerminaron: ['Fainá (porción)'] })),
    ).toBe('Perdón: se terminó Fainá (porción) y lo saqué del pedido. ¿Querés cambiarlo por otra cosa?');
  });

  it('a mano: el local lo revisa', () => {
    expect(respuestaBot(datos({ confirmacion: { tipo: 'a_mano' } }))).toBe(
      '¡Perfecto! El local lo revisa y te confirma el total en un momento.',
    );
  });

  it('el motivo para el cajero', () => {
    expect(motivoManual('cliente_nuevo')).toBe('Es el primer pedido de este cliente');
    expect(motivoManual('stock', 'Se terminó Fainá')).toBe('Se terminó Fainá');
    expect(motivoManual('apagada')).toBeNull();
  });
});
