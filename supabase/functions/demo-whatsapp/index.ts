// demo-whatsapp: el simulador de WhatsApp de la demo pública (/demo).
//
// El visitante escribe como si fuera un cliente y el mensaje entra por el MISMO camino que uno
// real del webhook: recibir_mensaje_wa (dedupe, cliente, conversación, límites) y después el
// intérprete compartido, que además deja la respuesta del bot. No pasa por Meta.
//   1. Sesión de usuario (el visitante es un usuario anónimo) y miembro de un local de demo.
//      Solo locales de demo: nadie puede inyectar mensajes en un local real.
//   2. Tope diario de mensajes de la demo (demo_puede_recibir), además de los por minuto.
//   3. El cliente es un teléfono de mentira derivado del usuario (telefonoDemo): cada
//      visitante es siempre el mismo cliente, y ninguno es un número real.
//   4. 200 enseguida; la IA corre después (EdgeRuntime.waitUntil), igual que el webhook.
// Privacidad: nunca se loguean mensajes.

import '@supabase/functions-js/edge-runtime.d.ts';
import { leerCuerpoJson, telefonoDemo } from '@anotado/shared';
import { withSupabase } from '@supabase/server';
import { z } from 'zod';
import { leerConfigIA } from '../_shared/config-ia.ts';
import { interpretarConversacion } from '../_shared/interpretar-whatsapp.ts';

const MAX_CUERPO_BYTES = 4 * 1024;

const EntradaSchema = z.object({
  texto: z.string().trim().min(1).max(500),
});

function error(status: number, mensaje: string) {
  return Response.json({ error: mensaje }, { status });
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return error(405, 'Método no permitido');
    const leido = await leerCuerpoJson(req, MAX_CUERPO_BYTES);
    if ('status' in leido) return error(leido.status, leido.status === 413 ? 'Mensaje demasiado largo' : 'Datos inválidos');
    const entrada = EntradaSchema.safeParse(leido.cuerpo);
    if (!entrada.success) return error(400, 'Escribí un mensaje de hasta 500 caracteres');

    // 1. Local de demo del visitante. Desde acá, service_role: todo filtra por el local.
    const userId = ctx.userClaims?.id;
    if (!userId) return error(401, 'Sesión inválida');
    const admin = ctx.supabaseAdmin;
    const { data: membresias, error: errMiembro } = await admin.from('miembros').select('negocio_id').eq('user_id', userId);
    if (errMiembro) return error(500, 'No se pudo verificar la demo');
    const ids = (membresias ?? []).map((m) => m.negocio_id);
    const { data: negocio, error: errNegocio } = ids.length
      ? await admin
          .from('negocios')
          .select('id, wa_phone_number_id')
          .in('id', ids)
          .eq('es_demo', true)
          .eq('activo', true)
          .not('wa_phone_number_id', 'is', null)
          .limit(1)
          .maybeSingle()
      : { data: null, error: null };
    if (errNegocio) return error(500, 'No se pudo verificar la demo');
    if (!negocio?.wa_phone_number_id) return error(403, 'El simulador es solo para la demo');

    // 2. Tope diario.
    const { data: puede, error: errCupo } = await admin.rpc('demo_puede_recibir', { p_negocio_id: negocio.id });
    if (errCupo) return error(500, 'No se pudo verificar el límite');
    if (!puede) return error(429, 'La demo llegó al límite de mensajes de hoy. Volvé mañana.');

    // 3. Mismo camino que un mensaje de WhatsApp.
    const telefono = telefonoDemo(userId);
    const { data, error: errRecibir } = await admin.rpc('recibir_mensaje_wa', {
      p_phone_number_id: negocio.wa_phone_number_id,
      p_wa_message_id: `demo:${crypto.randomUUID()}`,
      p_telefono: telefono,
      p_nombre: `Visitante ${telefono.slice(-4)}`,
      p_tipo: 'texto',
      p_contenido: entrada.data.texto,
    });
    if (errRecibir) {
      if (errRecibir.code === 'AN429') return error(429, 'Muchos mensajes en la demo ahora: probá en un minuto.');
      console.error('demo-whatsapp: no se pudo guardar el mensaje', errRecibir.code);
      return error(500, 'No se pudo mandar el mensaje');
    }
    const r = data as { negocio_id: string; conversacion_id: string; interpretar: boolean; limitado?: boolean } | null;
    if (!r) return error(500, 'No se pudo mandar el mensaje');
    if (r.limitado) return error(429, 'Mandaste muchos mensajes seguidos: esperá un minuto.');

    // 4. IA en segundo plano (con la ráfaga, como el webhook).
    if (r.interpretar) {
      const config = leerConfigIA();
      if (typeof config === 'string') {
        console.error(`demo-whatsapp: configuración de IA inválida: ${config}`);
      } else {
        EdgeRuntime.waitUntil(
          interpretarConversacion(admin, config, r.negocio_id, r.conversacion_id, { esperarRafaga: true, consumirLimite: true })
            .then((resultado) => {
              if (resultado === 'error' || resultado === 'error_ia') console.error(`demo-whatsapp: interpretación: ${resultado}`);
            })
            .catch((e) => console.error('demo-whatsapp: la interpretación falló', String(e).slice(0, 200))),
        );
      }
    }
    return Response.json({ conversacion_id: r.conversacion_id, telefono });
  }),
};
