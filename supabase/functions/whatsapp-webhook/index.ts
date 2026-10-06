// whatsapp-webhook: recibe los mensajes de WhatsApp Cloud API (Meta) y los deja en el mostrador.
//
// No pide sesión ni apikey (verify_jwt = false): la llama Meta. La autenticación es la firma.
//   GET:  verificación de la suscripción. Meta manda hub.verify_token (tiene que ser
//         WA_VERIFY_TOKEN) y se le devuelve hub.challenge.
//   POST: 1. Cuerpo crudo acotado y firma X-Hub-Signature-256 = HMAC-SHA256(cuerpo, WA_APP_SECRET).
//            Sin firma válida: 401 sin leer nada. Sin WA_APP_SECRET: 503 (falla cerrado).
//         2. Cada mensaje se GUARDA antes de contestar (recibir_mensaje_wa): dedupe por
//            wa_message_id (Meta reintenta), local por phone_number_id, cliente por teléfono.
//            Si la base falla, 500 y Meta vuelve a mandar todo (lo ya guardado no se duplica).
//         3. 200 enseguida. La IA corre DESPUÉS (EdgeRuntime.waitUntil), así Meta no espera
//            ni reintenta por una IA lenta. Si la IA no corre, los mensajes igual se ven.
// El pedido NUNCA se crea acá: la IA propone y el cajero confirma.
// Privacidad (Ley 18.331): nunca se loguean mensajes, nombres ni teléfonos.

import '@supabase/functions-js/edge-runtime.d.ts';
import { extraerMensajes, leerBytesAcotados, verificarFirma, WebhookWhatsAppSchema } from '@anotado/shared';
import { withSupabase } from '@supabase/server';
import { leerConfigIA } from '../_shared/config-ia.ts';
import { interpretarConversacion } from '../_shared/interpretar-whatsapp.ts';

// Meta manda de a pocos mensajes por webhook; 512 KB sobra.
const MAX_CUERPO_BYTES = 512 * 1024;

const vacia = (status: number) => new Response(null, { status });

/** Comparación en tiempo constante (el verify token es un secreto). */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

/** Verificación de la suscripción del webhook (la hace Meta una vez, al configurarlo). */
function verificarSuscripcion(url: URL): Response {
  const token = Deno.env.get('WA_VERIFY_TOKEN');
  const modo = url.searchParams.get('hub.mode');
  const recibido = url.searchParams.get('hub.verify_token') ?? '';
  const desafio = url.searchParams.get('hub.challenge') ?? '';
  if (!token || modo !== 'subscribe' || !iguales(recibido, token) || !/^[A-Za-z0-9_-]{1,100}$/.test(desafio)) {
    return vacia(403);
  }
  return new Response(desafio, { status: 200, headers: { 'content-type': 'text/plain' } });
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method === 'GET') return verificarSuscripcion(new URL(req.url));
    if (req.method !== 'POST') return vacia(405);

    // 1. Firma.
    const secreto = Deno.env.get('WA_APP_SECRET');
    if (!secreto) {
      console.error('whatsapp-webhook: falta WA_APP_SECRET');
      return vacia(503);
    }
    const declarado = Number(req.headers.get('content-length'));
    if (Number.isFinite(declarado) && declarado > MAX_CUERPO_BYTES) return vacia(413);
    const bytes = await leerBytesAcotados(req.body, MAX_CUERPO_BYTES).catch(() => null);
    if (!bytes) return vacia(413);
    if (!(await verificarFirma(bytes, req.headers.get('x-hub-signature-256'), secreto))) return vacia(401);

    // Firmado por Meta pero con una forma que no conocemos: 200, para que no lo reintente
    // durante días. No hay nada que guardar.
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return vacia(200);
    }
    const payload = WebhookWhatsAppSchema.safeParse(json);
    if (!payload.success) return vacia(200);

    // 2. Guardar cada mensaje, en orden.
    const admin = ctx.supabaseAdmin;
    const aInterpretar = new Map<string, string>(); // conversación → negocio
    for (const m of extraerMensajes(payload.data)) {
      const { data, error } = await admin.rpc('recibir_mensaje_wa', {
        p_phone_number_id: m.phoneNumberId,
        p_wa_message_id: m.waMessageId,
        p_telefono: m.telefono,
        p_nombre: m.nombre,
        p_tipo: m.tipo,
        p_contenido: m.contenido,
      });
      if (error) {
        // Datos que la base rechaza (no deberían llegar: ya se validaron): se saltea ese
        // mensaje, porque reintentarlo daría lo mismo. Cualquier otro error: Meta reintenta.
        if (error.code === '22023') continue;
        console.error('whatsapp-webhook: no se pudo guardar el mensaje', error.code);
        return vacia(500);
      }
      const r = data as { negocio_id: string; conversacion_id: string; interpretar: boolean } | null;
      if (r?.interpretar) aInterpretar.set(r.conversacion_id, r.negocio_id);
    }

    // 3. IA en segundo plano.
    if (aInterpretar.size > 0) {
      const config = leerConfigIA();
      if (typeof config === 'string') {
        console.error(`whatsapp-webhook: configuración de IA inválida: ${config}`);
      } else {
        EdgeRuntime.waitUntil(
          Promise.allSettled(
            [...aInterpretar].map(([conversacionId, negocioId]) =>
              interpretarConversacion(admin, config, negocioId, conversacionId, { esperarRafaga: true, consumirLimite: true }),
            ),
          ).then((resultados) => {
            for (const r of resultados) {
              if (r.status === 'rejected') console.error('whatsapp-webhook: la interpretación falló', String(r.reason).slice(0, 200));
              else if (r.value === 'error' || r.value === 'error_ia') console.error(`whatsapp-webhook: interpretación: ${r.value}`);
            }
          }),
        );
      }
    }
    return vacia(200);
  }),
};
