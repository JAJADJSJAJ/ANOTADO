import { describe, expect, it } from 'vitest';
import { formatearPrecio, parsearPrecio } from '../src/index.ts';

describe('formatearPrecio', () => {
  it('pesos enteros sin decimales', () => {
    expect(formatearPrecio(0)).toBe('$ 0');
    expect(formatearPrecio(28000)).toBe('$ 280');
    expect(formatearPrecio(125000)).toBe('$ 1.250');
    expect(formatearPrecio(123456700)).toBe('$ 1.234.567');
  });

  it('muestra centavos cuando hay', () => {
    expect(formatearPrecio(12550)).toBe('$ 125,50');
    expect(formatearPrecio(105)).toBe('$ 1,05');
  });

  it('negativos', () => {
    expect(formatearPrecio(-5000)).toBe('-$ 50');
  });

  it('rechaza decimales', () => {
    expect(() => formatearPrecio(10.5)).toThrow();
  });
});

describe('parsearPrecio', () => {
  it('pesos enteros', () => {
    expect(parsearPrecio('280')).toBe(28000);
    expect(parsearPrecio(' $ 280 ')).toBe(28000);
  });

  it('separador de miles con punto', () => {
    expect(parsearPrecio('1.250')).toBe(125000);
    expect(parsearPrecio('1.234.567')).toBe(123456700);
  });

  it('decimales con coma o punto', () => {
    expect(parsearPrecio('125,50')).toBe(12550);
    expect(parsearPrecio('125,5')).toBe(12550);
    expect(parsearPrecio('125.50')).toBe(12550);
    expect(parsearPrecio('1.250,05')).toBe(125005);
  });

  it('inválidos', () => {
    for (const t of ['', 'abc', '-5', '1,234', '12,345,6', '1.2.3']) {
      expect(parsearPrecio(t), t).toBeNull();
    }
  });
});
