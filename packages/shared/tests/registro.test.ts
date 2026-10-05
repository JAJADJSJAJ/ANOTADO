import { describe, expect, it } from 'vitest';
import { CodigoAltaSchema, EntregaSchema, normalizarCodigo, RegistroSchema } from '../src/index.ts';

const token = 'a'.repeat(43);

describe('código de alta', () => {
  it('se escribe como sea', () => {
    expect(normalizarCodigo(' k7q2-m9xp 4t8r ')).toBe('K7Q2M9XP4T8R');
    expect(CodigoAltaSchema.parse('k7q2-m9xp-4t8r')).toBe('K7Q2M9XP4T8R');
  });
  it('rechaza largos y letras que el operador no genera', () => {
    expect(CodigoAltaSchema.safeParse('K7Q2-M9XP').success).toBe(false);
    expect(CodigoAltaSchema.safeParse('K7Q2-M9XP-4T8O').success).toBe(false);
  });
});

describe('RegistroSchema', () => {
  const base = { email: 'ana@local.uy', password: 'una clave larga' };

  it('con código o con invitación', () => {
    expect(RegistroSchema.safeParse({ ...base, codigo: 'K7Q2-M9XP-4T8R' }).success).toBe(true);
    expect(RegistroSchema.safeParse({ ...base, invitacion: token }).success).toBe(true);
  });
  it('no las dos cosas, ni ninguna', () => {
    expect(RegistroSchema.safeParse({ ...base, codigo: 'K7Q2-M9XP-4T8R', invitacion: token }).success).toBe(false);
    expect(RegistroSchema.safeParse(base).success).toBe(false);
  });
  it('contraseña de 8 a 72 bytes', () => {
    expect(RegistroSchema.safeParse({ ...base, password: 'corta', invitacion: token }).success).toBe(false);
    expect(RegistroSchema.safeParse({ ...base, password: 'ñ'.repeat(37), invitacion: token }).success).toBe(false);
  });
  it('mail válido', () => {
    expect(RegistroSchema.safeParse({ ...base, email: 'ana', invitacion: token }).success).toBe(false);
  });
});

describe('entrega con zona', () => {
  it('delivery acepta zona_id opcional', () => {
    const zona = '0b6f1f43-8f9e-4a8e-9a35-6a1a1d1c2b3d';
    expect(EntregaSchema.parse({ modo: 'delivery', direccion: 'Uruguay 123', zona_id: zona })).toEqual({
      modo: 'delivery',
      direccion: 'Uruguay 123',
      zona_id: zona,
    });
    expect(EntregaSchema.safeParse({ modo: 'delivery', direccion: 'Uruguay 123', zona_id: 'centro' }).success).toBe(false);
  });
});
