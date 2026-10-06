import { describe, expect, it } from 'vitest';
import { CodigoAltaSchema, EntregaSchema, normalizarCodigo, PasswordSchema, RegistroSchema, rutaInterna } from '../src/index.ts';

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
  const email = 'ana@local.uy';

  it('con código o con invitación', () => {
    expect(RegistroSchema.safeParse({ email, codigo: 'K7Q2-M9XP-4T8R' }).success).toBe(true);
    expect(RegistroSchema.safeParse({ email, invitacion: token }).success).toBe(true);
  });
  it('no las dos cosas, ni ninguna', () => {
    expect(RegistroSchema.safeParse({ email, codigo: 'K7Q2-M9XP-4T8R', invitacion: token }).success).toBe(false);
    expect(RegistroSchema.safeParse({ email }).success).toBe(false);
  });
  it('sin contraseña: se elige después de confirmar el mail', () => {
    expect(RegistroSchema.safeParse({ email, password: 'una clave larga', invitacion: token }).success).toBe(false);
  });
  it('mail válido', () => {
    expect(RegistroSchema.safeParse({ email: 'ana', invitacion: token }).success).toBe(false);
  });
});

describe('PasswordSchema', () => {
  it('de 8 a 72 bytes', () => {
    expect(PasswordSchema.safeParse('corta').success).toBe(false);
    expect(PasswordSchema.safeParse('una clave larga').success).toBe(true);
    expect(PasswordSchema.safeParse('ñ'.repeat(37)).success).toBe(false);
  });
});

describe('rutaInterna', () => {
  it('acepta rutas de la app', () => {
    expect(rutaInterna('/invitacion/abc')).toBe('/invitacion/abc');
    expect(rutaInterna('/registro?codigo=K7Q2-M9XP-4T8R')).toBe('/registro?codigo=K7Q2-M9XP-4T8R');
  });
  it.each(['//otro.sitio', '/\\otro.sitio', 'https://otro.sitio', 'javascript:alert(1)', '', null])(
    'rechaza %s',
    (ruta) => {
      expect(rutaInterna(ruta)).toBe('/');
    },
  );
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
