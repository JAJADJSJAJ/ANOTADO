import { describe, expect, it } from 'vitest';
import { formatearPrecio } from '../src/index.ts';

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
