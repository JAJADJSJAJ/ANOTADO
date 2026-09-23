import { describe, expect, it } from 'vitest';
import {
  MAX_CANTIDAD,
  MAX_ITEMS,
  agregarItem,
  borradorVacio,
  cambiarCantidad,
  cambiarNotas,
  quitarItem,
  totalEstimado,
} from '../src/index.ts';

const COMPLETA = '11111111-1111-4111-8111-111111111111';
const COCA = '22222222-2222-4222-8222-222222222222';

describe('agregarItem', () => {
  it('agrega una línea nueva', () => {
    const b = agregarItem(borradorVacio(), COMPLETA);
    expect(b.items).toEqual([{ producto_id: COMPLETA, cantidad: 1 }]);
  });

  it('suma a la línea existente del mismo producto y mismas notas', () => {
    let b = agregarItem(borradorVacio(), COMPLETA, 1, 'sin tomate');
    b = agregarItem(b, COMPLETA, 2, '  sin tomate ');
    expect(b.items).toEqual([{ producto_id: COMPLETA, cantidad: 3, notas: 'sin tomate' }]);
  });

  it('notas distintas son líneas distintas', () => {
    let b = agregarItem(borradorVacio(), COMPLETA);
    b = agregarItem(b, COMPLETA, 1, 'sin cebolla');
    expect(b.items).toHaveLength(2);
  });

  it('no pasa de MAX_CANTIDAD', () => {
    const b = agregarItem(borradorVacio(), COCA, 50);
    expect(b.items[0]!.cantidad).toBe(MAX_CANTIDAD);
    expect(agregarItem(b, COCA).items[0]!.cantidad).toBe(MAX_CANTIDAD);
  });

  it('no pasa de MAX_ITEMS líneas', () => {
    let b = borradorVacio();
    for (let i = 0; i < MAX_ITEMS + 5; i++) b = agregarItem(b, COCA, 1, `nota ${i}`);
    expect(b.items).toHaveLength(MAX_ITEMS);
  });

  it('no muta el borrador original', () => {
    const original = borradorVacio();
    agregarItem(original, COCA);
    expect(original.items).toHaveLength(0);
  });
});

describe('cambiarCantidad / quitarItem / cambiarNotas', () => {
  const base = agregarItem(agregarItem(borradorVacio(), COMPLETA, 2), COCA);

  it('cambia la cantidad', () => {
    expect(cambiarCantidad(base, 0, 5).items[0]!.cantidad).toBe(5);
  });

  it('cantidad menor a 1 quita la línea', () => {
    expect(cambiarCantidad(base, 0, 0).items).toEqual([{ producto_id: COCA, cantidad: 1 }]);
  });

  it('índice inexistente no cambia nada', () => {
    expect(cambiarCantidad(base, 9, 3)).toBe(base);
    expect(cambiarNotas(base, 9, 'x')).toBe(base);
  });

  it('quita por índice', () => {
    expect(quitarItem(base, 1).items).toEqual([{ producto_id: COMPLETA, cantidad: 2 }]);
  });

  it('pone y saca notas', () => {
    const con = cambiarNotas(base, 0, ' bien cocida ');
    expect(con.items[0]).toEqual({ producto_id: COMPLETA, cantidad: 2, notas: 'bien cocida' });
    expect(cambiarNotas(con, 0, '   ').items[0]).toEqual({ producto_id: COMPLETA, cantidad: 2 });
  });
});

describe('totalEstimado', () => {
  it('suma precio por cantidad; productos sin precio cuentan 0', () => {
    const b = agregarItem(agregarItem(borradorVacio(), COMPLETA, 2), COCA);
    expect(totalEstimado(b, new Map([[COMPLETA, 28000], [COCA, 15000]]))).toBe(71000);
    expect(totalEstimado(b, new Map([[COMPLETA, 28000]]))).toBe(56000);
  });
});
