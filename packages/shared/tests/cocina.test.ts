import { describe, expect, it } from 'vitest';
import {
  colorTemporizador,
  CONFIG_COCINA_DEFECTO,
  desfaseReloj,
  estadoAnterior,
  leerConfigCocina,
  minutosDesde,
  ordenarPedidos,
  type PedidoCocina,
  pedidosNuevos,
  puedeAvanzar,
  puedeCancelar,
  puedeRetroceder,
  RespuestaCocinaSchema,
  siguienteEstado,
  textoEntrega,
} from '../src/index.ts';

const pedido = (id: string, numero: number, created_at: string, estado: PedidoCocina['estado'] = 'pendiente'): PedidoCocina => ({
  id,
  numero,
  estado,
  origen: 'mostrador',
  modo_entrega: 'retiro',
  mesa: null,
  notas: null,
  created_at,
  items: [],
});

const ID1 = 'a4000000-0000-4000-8000-000000000001';
const ID2 = 'a4000000-0000-4000-8000-000000000002';
const ID3 = 'a4000000-0000-4000-8000-000000000003';

describe('estados', () => {
  it('recorrido pendiente → en cocina → listo → entregado', () => {
    expect(siguienteEstado('pendiente')).toBe('en_cocina');
    expect(siguienteEstado('en_cocina')).toBe('listo');
    expect(siguienteEstado('listo')).toBe('entregado');
    expect(siguienteEstado('entregado')).toBeNull();
    expect(siguienteEstado('cancelado')).toBeNull();
    expect(estadoAnterior('pendiente')).toBeNull();
    expect(estadoAnterior('entregado')).toBe('listo');
    expect(estadoAnterior('cancelado')).toBeNull();
  });

  it('cocina cocina, el mostrador entrega, el dueño todo', () => {
    expect(puedeAvanzar('cocina', 'pendiente')).toBe(true);
    expect(puedeAvanzar('cocina', 'en_cocina')).toBe(true);
    expect(puedeAvanzar('cocina', 'listo')).toBe(false);
    expect(puedeAvanzar('cajero', 'pendiente')).toBe(false);
    expect(puedeAvanzar('cajero', 'listo')).toBe(true);
    for (const e of ['pendiente', 'en_cocina', 'listo'] as const) expect(puedeAvanzar('dueno', e)).toBe(true);
    expect(puedeAvanzar('dueno', 'entregado')).toBe(false);
  });

  it('deshacer lo puede quien hizo el paso', () => {
    expect(puedeRetroceder('cocina', 'listo')).toBe(true);
    expect(puedeRetroceder('cocina', 'entregado')).toBe(false);
    expect(puedeRetroceder('cajero', 'entregado')).toBe(true);
    expect(puedeRetroceder('cajero', 'listo')).toBe(false);
    expect(puedeRetroceder('dueno', 'pendiente')).toBe(false);
  });

  it('cancela solo el mostrador y nunca un entregado', () => {
    expect(puedeCancelar('cajero', 'listo')).toBe(true);
    expect(puedeCancelar('dueno', 'pendiente')).toBe(true);
    expect(puedeCancelar('cocina', 'pendiente')).toBe(false);
    expect(puedeCancelar('cajero', 'entregado')).toBe(false);
    expect(puedeCancelar('cajero', 'cancelado')).toBe(false);
  });
});

describe('temporizador', () => {
  it('verde, amarillo y rojo con los valores por defecto', () => {
    expect(colorTemporizador(0, CONFIG_COCINA_DEFECTO)).toBe('verde');
    expect(colorTemporizador(9, CONFIG_COCINA_DEFECTO)).toBe('verde');
    expect(colorTemporizador(10, CONFIG_COCINA_DEFECTO)).toBe('amarillo');
    expect(colorTemporizador(19, CONFIG_COCINA_DEFECTO)).toBe('amarillo');
    expect(colorTemporizador(20, CONFIG_COCINA_DEFECTO)).toBe('rojo');
  });

  it('con la config del dueño', () => {
    const c = leerConfigCocina({ cocina: { amarillo_min: 25, rojo_min: 40 } });
    expect(c).toEqual({ amarilloMin: 25, rojoMin: 40 });
    expect(colorTemporizador(24, c)).toBe('verde');
    expect(colorTemporizador(40, c)).toBe('rojo');
  });

  it('config faltante o inválida → valores por defecto', () => {
    expect(leerConfigCocina(null)).toEqual(CONFIG_COCINA_DEFECTO);
    expect(leerConfigCocina({})).toEqual(CONFIG_COCINA_DEFECTO);
    expect(leerConfigCocina({ cocina: 'x' })).toEqual(CONFIG_COCINA_DEFECTO);
    expect(leerConfigCocina({ cocina: { amarillo_min: 20, rojo_min: 10 } })).toEqual(CONFIG_COCINA_DEFECTO);
    expect(leerConfigCocina({ cocina: { amarillo_min: 0, rojo_min: 10 } })).toEqual(CONFIG_COCINA_DEFECTO);
    expect(leerConfigCocina({ cocina: { amarillo_min: 5.5, rojo_min: 10 } })).toEqual(CONFIG_COCINA_DEFECTO);
  });

  it('minutos desde que entró, nunca negativos', () => {
    const t = Date.parse('2026-09-24T20:00:00Z');
    expect(minutosDesde('2026-09-24T19:45:30Z', t)).toBe(14);
    expect(minutosDesde('2026-09-24T20:01:00Z', t)).toBe(0);
    expect(minutosDesde('basura', t)).toBe(0);
  });

  it('desfase de reloj descontando la latencia', () => {
    // La tablet atrasa 60 s; la solicitud tardó 200 ms.
    const inicio = Date.parse('2026-09-24T20:00:00.000Z');
    expect(desfaseReloj('2026-09-24T20:01:00.100Z', inicio, inicio + 200)).toBe(60_000);
    expect(desfaseReloj('basura', inicio, inicio)).toBe(0);
  });
});

describe('lista', () => {
  it('lo más viejo a la izquierda', () => {
    const ps = [pedido(ID2, 2, '2026-09-24T20:05:00Z'), pedido(ID1, 1, '2026-09-24T20:00:00Z'), pedido(ID3, 3, '2026-09-24T20:05:00Z')];
    expect(ordenarPedidos(ps).map((p) => p.numero)).toEqual([1, 2, 3]);
  });

  it('suena solo por pendientes nuevos', () => {
    const antes = [pedido(ID1, 1, '2026-09-24T20:00:00Z')];
    const ahora = [
      pedido(ID1, 1, '2026-09-24T20:00:00Z'),
      pedido(ID2, 2, '2026-09-24T20:01:00Z'),
      pedido(ID3, 3, '2026-09-24T20:02:00Z', 'en_cocina'),
    ];
    expect(pedidosNuevos(antes, ahora).map((p) => p.numero)).toEqual([2]);
  });

  it('texto de entrega sin dirección', () => {
    expect(textoEntrega({ modo_entrega: 'delivery', mesa: null })).toBe('Delivery');
    expect(textoEntrega({ modo_entrega: 'mesa', mesa: '4' })).toBe('Mesa 4');
    expect(textoEntrega({ modo_entrega: 'retiro', mesa: null })).toBe('Retira');
    expect(textoEntrega({ modo_entrega: null, mesa: null })).toBe('Sin definir');
  });

  it('valida la respuesta de pedidos_cocina', () => {
    const ok = RespuestaCocinaSchema.safeParse({
      ahora: '2026-09-24T20:00:00Z',
      pedidos: [{ ...pedido(ID1, 1, '2026-09-24T20:00:00Z'), items: [{ nombre: 'Chivito', cantidad: 2, notas: null }] }],
    });
    expect(ok.success).toBe(true);
    expect(RespuestaCocinaSchema.safeParse({ ahora: 'x', pedidos: [{ id: 'no' }] }).success).toBe(false);
  });
});
