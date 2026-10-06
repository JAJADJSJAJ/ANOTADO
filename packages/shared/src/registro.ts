import { z } from 'zod';

// Alta de cuentas (Edge Function `registro`) y de locales. Las cuentas solo se crean con un
// código del operador o una invitación de un dueño: el registro público está apagado.

export const MIN_PASSWORD = 8;
/** bcrypt (lo que usa Supabase Auth) ignora lo que pase de 72 bytes. */
export const MAX_PASSWORD = 72;
export const MAX_NOMBRE_LOCAL = 120;

/** El operador entrega "K7Q2-M9XP-4T8R-WN3H" (16 caracteres, 80 bits); la persona puede escribirlo como quiera. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const CodigoAltaSchema = z
  .string()
  .transform(normalizarCodigo)
  .pipe(z.string().regex(/^[2-9A-HJ-NP-Z]{16}$/, 'El código tiene 16 letras y números'));

/** Token de invitación: 32 bytes en base64url. */
export const TokenInvitacionSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** La contraseña se elige DESPUÉS de confirmar el mail (pantalla /bienvenida). */
export const PasswordSchema = z
  .string()
  .min(MIN_PASSWORD, `La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres`)
  .refine((p) => new TextEncoder().encode(p).length <= MAX_PASSWORD, 'La contraseña es demasiado larga');

/**
 * Lo que recibe la Edge Function `registro`: el mail y un código de alta o una invitación, no
 * los dos. Sin contraseña: la cuenta se crea sin confirmar y Supabase manda un mail; la
 * contraseña la elige quien abre ese mail. Así nadie puede ocupar un mail ajeno.
 */
export const RegistroSchema = z.union([
  z.strictObject({ email: z.email().max(254), codigo: CodigoAltaSchema }),
  z.strictObject({ email: z.email().max(254), invitacion: TokenInvitacionSchema }),
]);

export type Registro = z.infer<typeof RegistroSchema>;

export const NombreLocalSchema = z.string().trim().min(1, 'Falta el nombre del local').max(MAX_NOMBRE_LOCAL);

/**
 * Adónde vuelve la persona después de confirmar el mail. Solo rutas internas: "/algo", nunca
 * "//otro.sitio" ni "/\otro.sitio" (redirección abierta).
 */
export function rutaInterna(ruta: string | null | undefined, porDefecto = '/'): string {
  return ruta && /^\/(?![/\\])/.test(ruta) ? ruta : porDefecto;
}
