// registro: crea una cuenta con un código de alta del operador o una invitación de un dueño.
//
// El registro público de Supabase está apagado: esta función es la única forma de crear una
// cuenta desde la web. No pide sesión (quien se registra todavía no tiene), pero sí la
// publishable key de la web. Flujo:
//   1. Solicitud: POST, JSON de hasta 2 KB, validado con Zod (mail, contraseña de 8 a 72 bytes,
//      código o invitación con su formato).
//   2. registro_permitido: el código o la invitación tienen que estar vigentes, y se suma uno
//      a su contador. Máximo 3 cuentas por código o invitación: un link filtrado no sirve para
//      crear cuentas en serie. Los códigos y tokens tienen 60 y 256 bits: adivinarlos no es
//      una opción, así que no hace falta un límite por IP.
//   3. Crea la cuenta con el mail ya confirmado: sin SMTP no hay cómo verificarlo. Se acepta
//      porque solo llega acá quien tiene un código o una invitación.
// NO crea el local ni acepta la invitación: eso lo hace la web con la sesión nueva, con
// crear_negocio o aceptar_invitacion, que son las que consumen el código o la invitación.
// Privacidad (Ley 18.331): nunca se loguean mails ni contraseñas.

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

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    // 1. Solicitud.
    if (req.method !== 'POST') return error(405, 'Método no permitido');
    const leido = await leerCuerpoJson(req, MAX_CUERPO_BYTES);
    if ('status' in leido) return error(leido.status, MENSAJES_ENTRADA[leido.status]);
    const entrada = RegistroSchema.safeParse(leido.cuerpo);
    if (!entrada.success) return error(400, 'Datos inválidos');
    const { email, password } = entrada.data;
    const conCodigo = 'codigo' in entrada.data;

    // 2. Código o invitación vigente (y cuenta el intento).
    const admin = ctx.supabaseAdmin;
    const { data: permitido, error: errPermiso } = await admin.rpc(
      'registro_permitido',
      'codigo' in entrada.data ? { p_codigo: entrada.data.codigo } : { p_token: entrada.data.invitacion },
    );
    if (errPermiso) return error(500, 'No se pudo verificar el código');
    if (permitido !== true) {
      return error(
        403,
        conCodigo ? 'El código no es válido, venció o ya se usó' : 'La invitación no existe, venció o ya se usó',
      );
    }

    // 3. Cuenta.
    const { error: errAlta } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (errAlta) {
      if (errAlta.code === 'email_exists') {
        return error(409, 'Ya hay una cuenta con ese mail. Entrá con tu contraseña.');
      }
      if (errAlta.code === 'weak_password') return error(400, 'La contraseña es muy débil');
      console.error(`registro: no se pudo crear la cuenta (${errAlta.code ?? errAlta.status})`);
      return error(500, 'No se pudo crear la cuenta');
    }
    return Response.json({ ok: true }, { status: 201 });
  }),
};
