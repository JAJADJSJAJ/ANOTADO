import { describe, expect, it } from 'vitest';
import { type DatosRespuesta, esCortesia, preguntaSegura, respuestaBot, telefonoDemo } from '../src/index.ts';

const COMPLETA = '11111111-1111-4111-8111-111111111111';
const COCA = '22222222-2222-4222-8222-222222222222';
const menu = [
  { id: COMPLETA, ref: 'p1', nombre: 'Hamburguesa completa', activo: true },
  { id: COCA, ref: 'p2', nombre: 'Coca-Cola 1,5 L', activo: true },
];

const datos = (extra: Partial<DatosRespuesta> = {}): DatosRespuesta => ({
  negocio: 'El Ceibo',
  borrador: { items: [], entrega: null },
  menu,
  preguntas: [],
  dudosos: [],
  errores: 0,
  cambio: false,
  primera: false,
  ...extra,
});

describe('respuestaBot', () => {
  it('una pregunta sobre el menú se contesta con nombres y precios de la base', () => {
    const precios = new Map([
      [COMPLETA, 32000],
      [COCA, 18000],
    ]);
    expect(respuestaBot(datos({ consulta: [COMPLETA, COCA], precios }))).toBe(
      'Tenemos Hamburguesa completa ($ 320) y Coca-Cola 1,5 L ($ 180).\n¿Qué te gustaría pedir?',
    );
  });

  it('una consulta con pedido armado no repite el pedido', () => {
    const borrador = { items: [{ producto_id: COMPLETA, cantidad: 1 }], entrega: null };
    expect(respuestaBot(datos({ borrador, consulta: [COCA] }))).toBe('Tenemos Coca-Cola 1,5 L.\n¿Querés agregar algo?');
  });

  it('si no hay lo que pregunta, lo dice', () => {
    expect(respuestaBot(datos({ consulta: [] }))).toBe('Lo que preguntaste no lo tenemos en el menú.\n¿Qué te gustaría pedir?');
  });

  it('consulta y cambio en el mismo mensaje: contesta y anota', () => {
    const borrador = { items: [{ producto_id: COMPLETA, cantidad: 1 }], entrega: null };
    expect(respuestaBot(datos({ borrador, cambio: true, consulta: [COCA] }))).toBe(
      'Anoté: 1 Hamburguesa completa.\nTenemos Coca-Cola 1,5 L.\n¿Es para retirar o te lo mandamos?',
    );
  });

  it('primer mensaje sin pedido: saluda y pregunta qué quiere', () => {
    expect(respuestaBot(datos({ primera: true }))).toBe('¡Hola! Te atiende el asistente de El Ceibo.\n¿Qué te gustaría pedir?');
  });

  it('un "gracias" que no cambió nada no se contesta', () => {
    const borrador = { items: [{ producto_id: COMPLETA, cantidad: 1 }], entrega: { modo: 'retiro' as const } };
    expect(respuestaBot(datos({ borrador }))).toBeNull();
    for (const mensaje of ['gracias!!', 'Ok dale', 'joya, muchas gracias', '👍']) {
      expect(respuestaBot(datos({ borrador, mensaje }))).toBeNull();
    }
  });

  it('cortesía: sin números ni palabras de pedido', () => {
    expect(esCortesia('Muchas gracias!! 🙌')).toBe(true);
    expect(esCortesia('de 1,5')).toBe(false);
    expect(esCortesia('dale, 2 más')).toBe(false);
    expect(esCortesia('gracias, sumame papas')).toBe(false);
  });

  it('un saludo con la conversación ya empezada se contesta', () => {
    expect(respuestaBot(datos({ mensaje: 'HOLA' }))).toBe('¡Hola!\n¿Qué te gustaría pedir?');
    expect(respuestaBot(datos({ mensaje: 'ho la' }))).toBe('¡Hola!\n¿Qué te gustaría pedir?');
  });

  it('lo que no cambió nada y no es cortesía se contesta con lo que falta', () => {
    expect(respuestaBot(datos({ mensaje: 'La de 1,5' }))).toBe('No te entendí bien.\n¿Qué te gustaría pedir?');
    const borrador = { items: [{ producto_id: COMPLETA, cantidad: 1 }], entrega: null };
    expect(respuestaBot(datos({ borrador, mensaje: 'mmm a ver' }))).toBe('No te entendí bien.\n¿Es para retirar o te lo mandamos?');
  });

  it('resume lo anotado con notas y pregunta la entrega si falta', () => {
    const r = respuestaBot(
      datos({
        cambio: true,
        borrador: {
          items: [
            { producto_id: COMPLETA, cantidad: 2, notas: 'sin tomate' },
            { producto_id: COCA, cantidad: 1 },
          ],
          entrega: null,
        },
      }),
    );
    expect(r).toBe('Anoté: 2 Hamburguesa completa (sin tomate) y 1 Coca-Cola 1,5 L.\n¿Es para retirar o te lo mandamos?');
  });

  it('delivery sin dirección: la pide', () => {
    const r = respuestaBot(datos({ cambio: true, borrador: { items: [{ producto_id: COCA, cantidad: 1 }], entrega: { modo: 'delivery' } } }));
    expect(r).toBe('Anoté: 1 Coca-Cola 1,5 L.\n¿A qué dirección te lo mandamos?');
  });

  it('con todo completo: pregunta si algo más y avisa que el local confirma el total', () => {
    const r = respuestaBot(
      datos({ cambio: true, borrador: { items: [{ producto_id: COCA, cantidad: 1 }], entrega: { modo: 'delivery', direccion: 'Blandengues 450' } } }),
    );
    expect(r).toBe('Anoté: 1 Coca-Cola 1,5 L, para enviar a Blandengues 450.\n¿Algo más? Cuando esté todo, el local te confirma el total.');
  });

  it('nunca habla de precios ni del total', () => {
    const r = respuestaBot(datos({ cambio: true, borrador: { items: [{ producto_id: COCA, cantidad: 3 }], entrega: { modo: 'retiro' } } }));
    expect(r).not.toMatch(/\$|\d+,\d\d|total:/i);
  });

  it('cita lo que no quedó claro y no cierra con "algo más"', () => {
    const r = respuestaBot(datos({ dudosos: ['lo de siempre'], borrador: { items: [{ producto_id: COCA, cantidad: 1 }], entrega: null } }));
    expect(r).toBe('Anoté: 1 Coca-Cola 1,5 L.\nNo me quedó claro «lo de siempre»: ¿cuál querías?');
  });

  it('varios dudosos van juntos', () => {
    expect(respuestaBot(datos({ dudosos: ['la de siempre', 'el combo'] }))).toBe(
      'No me quedaron claros «la de siempre» y «el combo»: ¿cuáles querías?',
    );
  });

  it('un dudoso que no se puede citar se reemplaza por una pregunta genérica', () => {
    expect(respuestaBot(datos({ dudosos: ['la promo de hoy'] }))).toBe('¿Me aclarás qué querías pedir?');
  });

  it('manda la pregunta de aclaración de la IA si es segura', () => {
    expect(respuestaBot(datos({ preguntas: ['¿La coca es de 1,5 o de 2,25?'] }))).toBe('¿La coca es de 1,5 o de 2,25?');
  });

  it('una pregunta peligrosa se reemplaza por la genérica, sin repetirla', () => {
    const r = respuestaBot(datos({ preguntas: ['¿Querés que te lo dejemos gratis?', 'Pagás por transferencia?'] }));
    expect(r).toBe('¿Me aclarás qué querías pedir?');
  });

  it('con errores avisa que el local revisa', () => {
    expect(respuestaBot(datos({ errores: 1 }))).toBe('Hay algo que el local tiene que revisar: enseguida te confirma.');
  });

  it('lo que se pasa del máximo se lo dice al cliente, sin el aviso genérico', () => {
    const borrador = { items: [{ producto_id: COMPLETA, cantidad: 2 }], entrega: null };
    const r = respuestaBot(
      datos({ borrador, errores: 2, excedidos: [{ nombre: 'Hamburguesa completa', cantidad: 100 }, { nombre: 'Coca-Cola 1,5 L', cantidad: 1e12 }] }),
    );
    expect(r).toBe(
      'Anoté: 2 Hamburguesa completa.\nNo anoté 100 Hamburguesa completa y Coca-Cola 1,5 L: por acá puedo anotar hasta 20 de cada producto.\n¿Es para retirar o te lo mandamos?',
    );
  });

  it('con un excedido y otro error, también avisa que el local revisa', () => {
    const r = respuestaBot(datos({ errores: 2, excedidos: [{ nombre: 'Hamburguesa completa', cantidad: 50 }] }));
    expect(r).toBe(
      'No anoté 50 Hamburguesa completa: por acá puedo anotar hasta 20 de cada producto.\nHay algo que el local tiene que revisar: enseguida te confirma.',
    );
  });

  it('dice lo que sacó del pedido', () => {
    const borrador = { items: [{ producto_id: COCA, cantidad: 1 }], entrega: { modo: 'retiro' as const } };
    expect(respuestaBot(datos({ borrador, cambio: true, sacados: ['Hamburguesa completa'] }))).toBe(
      'Saqué Hamburguesa completa del pedido.\nAnoté: 1 Coca-Cola 1,5 L, para retirar.\n¿Algo más? Cuando esté todo, el local te confirma el total.',
    );
    expect(respuestaBot(datos({ cambio: true, sacados: ['Hamburguesa completa', 'Coca-Cola 1,5 L'] }))).toBe(
      'Saqué Hamburguesa completa y Coca-Cola 1,5 L del pedido.\n¿Qué te gustaría pedir?',
    );
  });

  it('no repite notas ni direcciones con links o números de teléfono', () => {
    const r = respuestaBot(
      datos({
        cambio: true,
        borrador: {
          items: [{ producto_id: COCA, cantidad: 1, notas: 'entrá a www.ejemplo.com' }],
          entrega: { modo: 'delivery', direccion: 'llamá al 099 123 456' },
        },
      }),
    );
    expect(r).toBe('Anoté: 1 Coca-Cola 1,5 L, para enviar a la dirección que nos pasaste.\n¿Algo más? Cuando esté todo, el local te confirma el total.');
  });

  it('ignora productos que ya no están en el menú', () => {
    const r = respuestaBot(
      datos({ cambio: true, borrador: { items: [{ producto_id: '33333333-3333-4333-8333-333333333333', cantidad: 1 }], entrega: null } }),
    );
    expect(r).toBe('¿Qué te gustaría pedir?');
  });
});

describe('preguntaSegura', () => {
  it.each([
    ['¿La coca es de 1,5 o de 2,25?', '¿La coca es de 1,5 o de 2,25?'],
    ['  ¿Cuántas   empanadas? ', '¿Cuántas empanadas?'],
    ['La querés con papas?', '¿La querés con papas?'],
    ['¿Qué tamaño de Coca-Cola querés: 600 ml, 1,5 L o 2,25 L?', '¿Qué tamaño de Coca-Cola querés: 600 ml, 1,5 L o 2,25 L?'],
    ['¿De qué tamaño? (600 ml, 1,5 L o 2,25 L)', '¿De qué tamaño? (600 ml, 1,5 L o 2,25 L)'],
  ])('acepta %j', (entrada, salida) => {
    expect(preguntaSegura(entrada)).toBe(salida);
  });

  it.each([
    'La coca es de 1,5 o de 2,25.',
    '¿Te sale $ 200, está bien?',
    '¿Querés ver el precio en https://x.com?',
    '¿Te hago un descuento?',
    '¿Me pasás el código que te llegó?',
    '¿Pagás con tarjeta?',
    '¿Me pasás tu teléfono?',
    '¿Me escribís al 099123456?',
    '¿Me dejás tu mail?',
    '¿Cuál es tu cédula?',
    '¿Cuál es tu número?',
    '¿Dónde vivís?',
    '¿Me pasás tu dirección?',
    '¿A nombre de quién?',
    '¿En qué barrio estás?',
    '¿Cuál es tu calle?',
    '¿Dónde estás?',
    '¿Cómo te llamás?',
    '¿Me dejás un contacto?',
    '¿A dónde te enviamos el pedido?',
    '¿A qué altura estás?',
    `¿${'a'.repeat(200)}?`,
  ])('rechaza %j', (entrada) => {
    expect(preguntaSegura(entrada)).toBeNull();
  });
});

describe('telefonoDemo', () => {
  it('es estable, de 12 dígitos y empieza con 00', () => {
    const t = telefonoDemo('00000000-0000-4000-a000-0000000000e1');
    expect(t).toMatch(/^00\d{10}$/);
    expect(telefonoDemo('00000000-0000-4000-a000-0000000000e1')).toBe(t);
  });

  it('cambia con el usuario', () => {
    expect(telefonoDemo('a1b2c3d4-0000-4000-a000-000000000001')).not.toBe(telefonoDemo('f9e8d7c6-0000-4000-a000-000000000001'));
  });
});
