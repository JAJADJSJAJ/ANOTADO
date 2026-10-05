import { z } from 'zod';

// Alta de cuentas (Edge Function `registro`) y de locales. Las cuentas solo se crean con un
// código del operador o una invitación de un dueño: el registro público está apagado.

export const MIN_PASSWORD = 8;
/** bcrypt (lo que usa Supabase Auth) ignora lo que pase de 72 bytes. */
export const MAX_PASSWORD = 72;
export const MAX_NOMBRE_LOCAL = 120;

/** El operador entrega "K7Q2-M9XP-4T8R"; la persona puede escribirlo como quiera. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const CodigoAltaSchema = z
  .string()
  .transform(normalizarCodigo)
  .pipe(z.string().regex(/^[2-9A-HJ-NP-Z]{12}$/, 'El código tiene 12 letras y números'));

/** Token de invitación: 32 bytes en base64url. */
export const TokenInvitacionSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const PasswordSchema = z
  .string()
  .min(MIN_PASSWORD, `La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres`)
  .refine((p) => new TextEncoder().encode(p).length <= MAX_PASSWORD, 'La contraseña es demasiado larga');

/** Lo que recibe la Edge Function `registro`: un código de alta o una invitación, no los dos. */
export const RegistroSchema = z.union([
  z.strictObject({
    email: z.email().max(254),
    password: PasswordSchema,
    codigo: CodigoAltaSchema,
  }),
  z.strictObject({
    email: z.email().max(254),
    password: PasswordSchema,
    invitacion: TokenInvitacionSchema,
  }),
]);

export type Registro = z.infer<typeof RegistroSchema>;

export const NombreLocalSchema = z.string().trim().min(1, 'Falta el nombre del local').max(MAX_NOMBRE_LOCAL);
