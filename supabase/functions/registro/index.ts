// registro: crea una cuenta con un código de alta del operador o una invitación de un dueño, y
// manda un mail para confirmarla.
//
// El registro público de Supabase está apagado: esta función es la única forma de crear una
// cuenta desde la web. No pide sesión (quien se registra todavía no tiene), pero sí la
// publishable key de la web. Flujo:
//   1. Solicitud: POST, JSON de hasta 2 KB, validado con Zod (mail y código o invitación).
//   2. registro_permitido: el código o la invitación tienen que estar vigentes. Suma un intento
//      (máximo 10, no se devuelve) y un cupo de cuenta (máximo 3, se devuelve con
//      liberar_registro si la cuenta no se creó). Códigos de 60 bits y tokens de 256 no se
//      adivinan, así que no hace falta un límite por IP.
//   3. inviteUserByEmail: crea la cuenta SIN confirmar y SIN contraseña, y Supabase le manda un
//      mail. El link lleva a /bienvenida, donde quien abrió el mail elige su contraseña. Así
//      el mail queda verificado y nadie puede ocupar una dirección ajena: aunque alguien la
//      escriba primero, la contraseña la pone el dueño del buzón.
//      Si la cuenta existe pero no se confirmó, Supabase reenvía el mail. Si ya está
//      confirmada, 409: la persona entra con su contraseña.
// NO crea el local ni acepta la invitación: eso lo hace la web después de /bienvenida, con
// sesión, con crear_negocio o aceptar_invitacion, que son las que consumen código o invitación.
// Privacidad (Ley 18.331): nunca se loguean mails.

import '@supabase/functions-js/edge-runtime.d.ts';
import { leerCuerpoJson, RegistroSchema } from '@anotado/shared';
import { withSupabase } from '@supabase/server';

const MAX_CUERPO_BYTES = 2 * 1024;

function error(status: number, mensaje: string) {
  return Response.json({ error: mensaje }, { status });
}

const MENSAJES_ENTRADA: Record<400 | 413 | 415, string> = {
  400: 'Datos inválidos',
  413: 'Datos demasiado largos',
  415: 'Tipo de contenido no admitido: se espera application/json',
};

/**
 * Dirección de la web para el link del mail. SITIO_URL (secret) manda; si no está, el Origin
 * de la solicitud (desarrollo local). Igual Supabase Auth solo acepta redirecciones que estén
 * en *Redirect URLs*: con otra, usa la Site URL.
 */
function origenWeb(req: Request): string | null {
  const origen = Deno.env.get('SITIO_URL') ?? req.headers.get('origin');
  if (!origen) return null;
  try {
    const url = new URL(origen);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    // 1. Solicitud.
    if (req.method !== 'POST') return error(405, 'Método no permitido');
    const leido = await leerCuerpoJson(req, MAX_CUERPO_BYTES);
    if ('status' in leido) return error(leido.status, MENSAJES_ENTRADA[leido.status]);
    const entrada = RegistroSchema.safeParse(leido.cuerpo);
    if (!entrada.success) return error(400, 'Datos inválidos');
    const origen = origenWeb(req);
    if (!origen) return error(400, 'Falta el origen de la solicitud');

    const datos = entrada.data;
    const clave = 'codigo' in datos ? { p_codigo: datos.codigo } : { p_token: datos.invitacion };
    // Adónde sigue después de elegir la contraseña: lo arma el servidor, no la solicitud.
    const siguiente = 'codigo' in datos ? `/registro?codigo=${datos.codigo}` : `/invitacion/${datos.invitacion}`;

    // 2. Código o invitación vigente (suma intento y cupo).
    const admin = ctx.supabaseAdmin;
    const { data: permitido, error: errPermiso } = await admin.rpc('registro_permitido', clave);
    if (errPermiso) return error(500, 'No se pudo verificar el código');
    if (permitido !== true) {
      return error(
        403,
        'codigo' in datos
          ? 'El código no es válido, venció o ya se usó demasiadas veces'
          : 'La invitación no existe, venció o ya se usó',
      );
    }

    // 3. Cuenta sin confirmar + mail.
    const { error: errAlta } = await admin.auth.admin.inviteUserByEmail(datos.email, {
      redirectTo: `${origen}/bienvenida?siguiente=${encodeURIComponent(siguiente)}`,
    });
    if (errAlta) {
      // La cuenta no se creó: se devuelve el cupo (el intento queda contado).
      await admin.rpc('liberar_registro', clave);
      if (errAlta.code === 'email_exists') {
        return error(409, 'Ya tenés una cuenta con ese mail. Entrá con tu contraseña.');
      }
      if (errAlta.code === 'over_email_send_rate_limit') {
        return error(429, 'Se mandaron demasiados mails. Probá de nuevo en un rato.');
      }
      console.error(`registro: no se pudo crear la cuenta (${errAlta.code ?? errAlta.status})`);
      return error(500, 'No se pudo crear la cuenta');
    }
    return Response.json({ ok: true }, { status: 201 });
  }),
};
