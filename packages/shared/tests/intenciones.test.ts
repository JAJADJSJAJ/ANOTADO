import { describe, expect, it } from 'vitest';
import {
  aplicarAcciones,
  type Borrador,
  borradorVacio,
  type DatosRespuesta,
  leerPagos,
  type ProductoMenu,
  respuestaBot,
} from '../src/index.ts';

// Lo que el cliente quiere saber o hacer y no cambia productos: estado, pagos, cancelar y
// "eso es todo". La IA solo lo detecta; el bot contesta con plantillas.

const COMPLETA = '11111111-1111-4111-8111-111111111111';
const menu: ProductoMenu[] = [{ id: COMPLETA, ref: 'p1', nombre: 'Hamburguesa completa', activo: true }];
const armado: Borrador = { items: [{ producto_id: COMPLETA, cantidad: 1 }], entrega: { modo: 'retiro' } };

const datos = (extra: Partial<DatosRespuesta> = {}): DatosRespuesta => ({
  negocio: 'El Ceibo',
  borrador: borradorVacio(),
  menu,
  preguntas: [],
  dudosos: [],
  errores: 0,
  cambio: false,
  primera: false,
  ...extra,
});

describe('reducer', () => {
  it('estado y pago se marcan sin tocar el pedido', () => {
    const r = aplicarAcciones(armado, [{ tipo: 'estado' }, { tipo: 'pago' }], menu);
    expect(r.estado).toBe(true);
    expect(r.pago).toBe(true);
    expect(r.borrador).toEqual(armado);
  });

  it('cancelar con algo armado lo vacía; sin nada armado habla del pedido confirmado', () => {
    const conAlgo = aplicarAcciones(armado, [{ tipo: 'cancelar' }], menu);
    expect(conAlgo.cancelar).toBe('borrador');
    expect(conAlgo.borrador).toEqual({ items: [], entrega: null });
    expect(aplicarAcciones(borradorVacio(), [{ tipo: 'cancelar' }], menu).cancelar).toBe('pedido');
    expect(aplicarAcciones(armado, [], menu).cancelar).toBeNull();
  });
});

describe('respuestas del bot', () => {
  it('cuenta cómo va el pedido según el estado y la entrega', () => {
    expect(respuestaBot(datos({ estadoPedido: { numero: 12, estado: 'en_cocina', modo: 'retiro' } }))).toBe(
      'Tu pedido #12 se está preparando.',
    );
    expect(respuestaBot(datos({ estadoPedido: { numero: 12, estado: 'listo', modo: 'retiro' } }))).toBe(
      'Tu pedido #12 está listo. Podés pasar a retirarlo.',
    );
    expect(respuestaBot(datos({ estadoPedido: { numero: 12, estado: 'entregado', modo: 'delivery' } }))).toBe(
      'Tu pedido #12 ya salió. ¡Va en camino!',
    );
    expect(respuestaBot(datos({ estadoPedido: null }))).toBe('No encontré un pedido tuyo de hoy. ¿Qué te gustaría pedir?');
  });

  it('nombra las formas de pago del local, o deriva si no hay cargadas', () => {
    expect(respuestaBot(datos({ pagos: ['efectivo', 'debito', 'mercadopago'] }))).toBe(
      'Aceptamos efectivo, débito y Mercado Pago.',
    );
    expect(respuestaBot(datos({ pagos: [] }))).toBe('Las formas de pago te las confirma el local.');
  });

  it('cancelar: lo armado se cancela; lo confirmado en cocina se deriva; lo cancelado por la base no se repite', () => {
    expect(respuestaBot(datos({ cancelacion: 'borrador', cambio: true }))).toBe(
      'Listo, cancelé el pedido. Si querés pedir otra cosa, escribime.',
    );
    expect(
      respuestaBot(datos({ cancelacion: { pedido: { numero: 7, estado: 'en_cocina', modo: 'retiro' }, cancelado: false } })),
    ).toBe('Tu pedido #7 ya se está preparando, así que no lo puedo cancelar yo: le avisé al local y te contestan enseguida.');
    expect(
      respuestaBot(datos({ cancelacion: { pedido: { numero: 7, estado: 'pendiente', modo: 'retiro' }, cancelado: true } })),
    ).toBeNull();
    // Aunque sea el primer mensaje de una conversación nueva: no saluda encima del aviso.
    expect(
      respuestaBot(datos({ primera: true, cancelacion: { pedido: { numero: 7, estado: 'cancelado', modo: 'retiro' }, cancelado: true } })),
    ).toBeNull();
    expect(respuestaBot(datos({ cancelacion: null }))).toBe('No encontré un pedido tuyo de hoy para cancelar.');
  });

  it('"eso es todo" con el pedido completo: avisa que el local confirma', () => {
    expect(respuestaBot(datos({ borrador: armado, listo: true }))).toBe(
      '¡Perfecto! El local lo revisa y te confirma el total en un momento.',
    );
    // Sin entrega todavía, primero la pregunta.
    expect(respuestaBot(datos({ borrador: { ...armado, entrega: null }, listo: true, cambio: true }))).toBe(
      'Anoté: 1 Hamburguesa completa.\n¿Es para retirar o te lo mandamos?',
    );
  });
});

describe('leerPagos', () => {
  it('lee la config, ordena y descarta lo mal formado', () => {
    expect(leerPagos({ pagos: ['mercadopago', 'efectivo'] })).toEqual(['efectivo', 'mercadopago']);
    expect(leerPagos({ pagos: ['bitcoin'] })).toEqual([]);
    expect(leerPagos(null)).toEqual([]);
  });
});
