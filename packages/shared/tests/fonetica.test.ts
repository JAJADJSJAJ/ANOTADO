import { describe, expect, it } from 'vitest';
import { fonetica, separarCantidad } from '../src/index.ts';

describe('fonetica', () => {
  it('iguala lo que suena igual', () => {
    expect(fonetica('virra')).toBe(fonetica('birra'));
    expect(fonetica('Musarela')).toBe(fonetica('muzzarella'));
    expect(fonetica('amburgesa')).toBe(fonetica('hamburguesa'));
    expect(fonetica('kiero')).toBe(fonetica('quiero'));
    expect(fonetica('jamon i keso')).not.toBe(fonetica('jamón y queso')); // la i suelta no se adivina
    expect(fonetica('fainas')).toBe(fonetica('fainá'));
    expect(fonetica('xivito')).not.toBe(fonetica('chivito')); // x por ch: lo resuelve la IA, no esto
  });

  it('no confunde palabras distintas', () => {
    expect(fonetica('carne')).not.toBe(fonetica('cerveza'));
    expect(fonetica('chivito')).toBe('chibito');
    expect(fonetica('poyo')).toBe(fonetica('pollo'));
  });
});

describe('separarCantidad', () => {
  it('lee números y palabras', () => {
    expect(separarCantidad('2 virras')).toEqual({ cantidad: 2, resto: 'virras' });
    expect(separarCantidad('una musa')).toEqual({ cantidad: 1, resto: 'musa' });
    expect(separarCantidad('tres empanadas')).toEqual({ cantidad: 3, resto: 'empanadas' });
    expect(separarCantidad('lo de siempre')).toEqual({ cantidad: 1, resto: 'lo de siempre' });
  });
});
