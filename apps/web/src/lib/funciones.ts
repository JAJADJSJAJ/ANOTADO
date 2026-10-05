import { type Registro, RegistroSchema } from '@anotado/shared';
import { supabase } from './supabase.ts';

/**
 * El error de functions.invoke trae la respuesta HTTP: se usa el mensaje en español que manda
 * la función. Si no hay, el texto por defecto.
 */
export async function mensajeDeFuncion(error: unknown, porDefecto: string): Promise<string> {
  const respuesta = (error as { context?: Response } | null)?.context;
  if (respuesta && typeof respuesta.json === 'function') {
    const cuerpo = (await respuesta.json().catch(() => null)) as { error?: string } | null;
    if (cuerpo?.error) return cuerpo.error;
  }
  return porDefecto;
}

/**
 * Crea la cuenta (Edge Function registro) y entra con ella. Si el mail ya tiene cuenta, la
 * función responde 409 con un mensaje que lo dice: la persona entra con su contraseña.
 */
export async function crearCuentaYEntrar(datos: Registro): Promise<string | null> {
  const valido = RegistroSchema.safeParse(datos);
  if (!valido.success) return valido.error.issues[0]?.message ?? 'Revisá los datos.';

  const { error } = await supabase.functions.invoke('registro', { body: valido.data });
  if (error) return mensajeDeFuncion(error, 'No se pudo crear la cuenta. Probá de nuevo.');

  const { error: errLogin } = await supabase.auth.signInWithPassword({
    email: valido.data.email,
    password: valido.data.password,
  });
  return errLogin ? 'La cuenta se creó, pero no se pudo entrar. Probá desde "Entrar".' : null;
}
