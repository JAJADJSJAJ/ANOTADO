// registro: crea una cuenta con un código de alta del operador o una invitación de un dueño, y
// manda un mail para confirmarla.
//
// El registro público de Supabase está apagado: esta función es la única forma de crear una
// cuenta desde la web. No pide sesión (quien se registra todavía no tiene), pero sí la
// publishable key de la web. Flujo:
//   1. Solicitud: POST, JSON de hasta 2 KB, validado con Zod (mail y código o invitación).
//      El origen de la web para el link del mail sale de SITIO_URL; sin SITIO_URL solo se
//      acepta un Origin local (desarrollo). En la nube, sin SITIO_URL la función no da altas.
//   2. Límite de solicitudes por minuto (consumir_limite_registro), antes de mirar el código:
//      cuenta también las solicitudes con códigos inválidos. Por IP (hasheada) y total, porque
//      la IP de los headers se puede falsear: el total es el techo real.
//   3. reservar_registro: el código o la invitación tienen que estar vigentes y con cupo
//      (máximo 3 cuentas y 10 intentos). Devuelve el id de la reserva.
//   4. inviteUserByEmail: crea la cuenta SIN confirmar y SIN contraseña, y Supabase le manda un
//      mail. El link lleva a /bienvenida, donde quien abrió el mail elige su contraseña. Así
//      el mail queda verificado y nadie puede ocupar una dirección ajena: aunque alguien la
//      escriba primero, la contraseña la pone el dueño del buzón.
//      Si la cuenta existe pero no se confirmó, Supabase reenvía el mail. Si ya está
//      confirmada, 409: la persona entra con su contraseña.
//   5. resolver_reserva, SIEMPRE (haya error o no): la base decide si la reserva gastó un cupo
//      según si antes no había cuenta con ese mail y ahora sí. No se decide por el
//      error de Auth, que puede llegar con la cuenta ya creada (hook posterior al commit). Si
//      esta llamada no llega (corte), la reserva queda tomada: ante la duda, se gasta el cupo.
// NO crea el local ni acepta la invitación: eso lo hace la web después de /bienvenida, con
// sesión, con crear_negocio o aceptar_invitacion, que son las que consumen código o invitación.
// Privacidad (Ley 18.331): nunca se loguean mails ni IPs; la IP se guarda solo como hash.

import '@supabase/functions-js/edge-runtime.d.ts';
import { leerCuerpoJson, RegistroSchema } from '@anotado/shared';
import { withSupabase } from '@supabase/server';

const MAX_CUERPO_BYTES = 2 * 1024;
const LIMITE_POR_IP = 5; // por minuto
const LIMITE_TOTAL = 60; // por minuto, entre todas las IPs

function error(status: number, mensaje: string) {
  return Response.json({ error: mensaje }, { status });
}

const MENSAJES_ENTRADA: Record<400 | 413 | 415, string> = {
  400: 'Datos inválidos',
  413: 'Datos demasiado largos',
  415: 'Tipo de contenido no admitido: se espera application/json',
};

/**
 * Dirección de la web para el link del mail. SITIO_URL (secret) es la única válida en la nube.
 * Sin ella, solo se acepta un Origin local, para desarrollo. Así un deploy sin configurar
 * falla cerrado en vez de armar links con un origen que manda quien llama.
 */
function origenWeb(req: Request): string | null {
  const sitio = Deno.env.get('SITIO_URL');
  if (sitio) {
    try {
      const url = new URL(sitio);
      return url.protocol === 'https:' ? url.origin : null;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(req.headers.get('origin') ?? '');
    const local = ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:';
    return local ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * IP de quien llama, en sha256. Primero cf-connecting-ip (la pone el proxy); si no, la primera
 * de x-forwarded-for. Se puede falsear: por eso además hay un límite total.
 */
async function hashIp(req: Request): Promise<string> {
  const ip =
    req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconocida';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    // 1. Solicitud.
    if (req.method !== 'POST') return error(405, 'Método no permitido');
    const origen = origenWeb(req);
    if (!origen) {
      console.error('registro: falta SITIO_URL (o no es https)');
      return error(503, 'El registro no está disponible en este momento');
    }
    const admin = ctx.supabaseAdmin;

    // 2. Límite de solicitudes (también con datos inválidos).
    const { data: dentro, error: errLimite } = await admin.rpc('consumir_limite_registro', {
      p_ip_hash: await hashIp(req),
      p_max_ip: LIMITE_POR_IP,
      p_max_total: LIMITE_TOTAL,
    });
    if (errLimite) return error(500, 'No se pudo verificar el límite');
    if (dentro !== true) return error(429, 'Demasiados intentos. Probá de nuevo en un minuto.');

    const leido = await leerCuerpoJson(req, MAX_CUERPO_BYTES);
    if ('status' in leido) return error(leido.status, MENSAJES_ENTRADA[leido.status]);
    const entrada = RegistroSchema.safeParse(leido.cuerpo);
    if (!entrada.success) return error(400, 'Datos inválidos');

    const datos = entrada.data;
    const clave = 'codigo' in datos ? { p_codigo: datos.codigo } : { p_token: datos.invitacion };
    // Adónde sigue después de elegir la contraseña: lo arma el servidor, no la solicitud.
    const siguiente = 'codigo' in datos ? `/registro?codigo=${datos.codigo}` : `/invitacion/${datos.invitacion}`;

    // 3. Reserva de cupo.
    const { data: reserva, error: errReserva } = await admin.rpc('reservar_registro', { p_email: datos.email, ...clave });
    if (errReserva) return error(500, 'No se pudo verificar el código');
    if (typeof reserva !== 'string') {
      return error(
        403,
        'codigo' in datos
          ? 'El código no es válido, venció o ya se usó demasiadas veces'
          : 'La invitación no existe, venció o ya se usó',
      );
    }

    // 4. Cuenta sin confirmar + mail.
    const { error: errAlta } = await admin.auth.admin.inviteUserByEmail(datos.email, {
      redirectTo: `${origen}/bienvenida?siguiente=${encodeURIComponent(siguiente)}`,
    });

    // 5. La base decide si se gastó el cupo, con o sin error.
    const { error: errResolver } = await admin.rpc('resolver_reserva', { p_reserva: reserva });
    if (errResolver) console.error('registro: no se pudo resolver la reserva (queda tomada)');

    if (errAlta) {
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
