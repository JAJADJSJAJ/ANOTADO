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
 * Pide la cuenta (Edge Function registro). La función manda un mail: la persona lo abre, elige
 * su contraseña en /bienvenida y vuelve a donde estaba. Devuelve el error para mostrar, o null.
 */
export async function pedirCuenta(datos: Registro): Promise<string | null> {
  const valido = RegistroSchema.safeParse(datos);
  if (!valido.success) return valido.error.issues[0]?.message ?? 'Revisá los datos.';
  const { error } = await supabase.functions.invoke('registro', { body: valido.data });
  return error ? mensajeDeFuncion(error, 'No se pudo crear la cuenta. Probá de nuevo.') : null;
}
