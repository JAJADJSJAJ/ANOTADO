import { z } from 'zod';
import type { MensajeHistorial } from './ia/prompt.ts';

// Webhook de WhatsApp Cloud API (Meta): firma, forma del payload y cómo se guarda cada mensaje.
// Puro (sin red ni base): lo usa la Edge Function whatsapp-webhook y se testea con Vitest.

/** Máximo de caracteres de un mensaje guardado. Igual que el check de recibir_mensaje_wa. */
export const MAX_MENSAJE_WA = 2000;

export type TipoMensaje = 'texto' | 'audio' | 'imagen' | 'video' | 'documento' | 'ubicacion' | 'sticker' | 'contacto' | 'otro';

/** Un mensaje de un cliente, listo para recibir_mensaje_wa. */
export type MensajeEntrante = {
  /** phone_number_id del número del local que recibió el mensaje. */
  phoneNumberId: string;
  waMessageId: string;
  /** Teléfono del cliente, solo dígitos (wa_id). */
  telefono: string;
  /** Nombre del perfil de WhatsApp, si vino. */
  nombre: string | null;
  tipo: TipoMensaje;
  contenido: string;
};

// Solo los campos que se usan. passthrough no hace falta: lo que sobra se ignora.
const TextoSchema = z.object({ body: z.string() });
const MediaSchema = z.object({ caption: z.string().optional(), filename: z.string().optional() });

const MensajeMetaSchema = z.object({
  id: z.string().min(1).max(200),
  from: z.string().regex(/^[0-9]{6,20}$/),
  type: z.string(),
  text: TextoSchema.optional(),
  image: MediaSchema.optional(),
  video: MediaSchema.optional(),
  document: MediaSchema.optional(),
  location: z
    .object({
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  contacts: z.array(z.object({ name: z.object({ formatted_name: z.string().optional() }).optional() })).optional(),
  button: z.object({ text: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string().optional() }).optional(),
      list_reply: z.object({ title: z.string().optional() }).optional(),
    })
    .optional(),
});

const ValorSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().regex(/^[0-9]{5,30}$/) }),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
  // Cada mensaje se valida por separado: uno raro no tira abajo a los demás.
  messages: z.array(z.unknown()).optional(),
});

export const WebhookWhatsAppSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
});

const recortar = (texto: string) => {
  const limpio = texto.trim();
  return limpio.length > MAX_MENSAJE_WA ? `${limpio.slice(0, MAX_MENSAJE_WA - 1)}…` : limpio;
};

const conTexto = (etiqueta: string, ...partes: (string | undefined)[]) => {
  const extra = partes.map((p) => p?.trim()).filter(Boolean).join(' · ');
  return extra ? `${etiqueta} ${extra}` : etiqueta;
};

/**
 * Tipo y texto con que se guarda un mensaje. null = no se guarda (reacciones, avisos del
 * sistema): no son algo que el cliente le dijo al local.
 * Lo que no es texto lo ve el cajero; la IA solo interpreta 'texto'.
 */
export function convertirMensaje(m: z.infer<typeof MensajeMetaSchema>): { tipo: TipoMensaje; contenido: string } | null {
  switch (m.type) {
    case 'text':
      return m.text?.body.trim() ? { tipo: 'texto', contenido: recortar(m.text.body) } : null;
    case 'button':
      return m.button?.text?.trim() ? { tipo: 'texto', contenido: recortar(m.button.text) } : null;
    case 'interactive': {
      const titulo = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
      return titulo?.trim() ? { tipo: 'texto', contenido: recortar(titulo) } : null;
    }
    case 'audio':
      return { tipo: 'audio', contenido: '[Audio]' };
    case 'image':
      return { tipo: 'imagen', contenido: recortar(conTexto('[Foto]', m.image?.caption)) };
    case 'video':
      return { tipo: 'video', contenido: recortar(conTexto('[Video]', m.video?.caption)) };
    case 'document':
      return { tipo: 'documento', contenido: recortar(conTexto('[Archivo]', m.document?.filename, m.document?.caption)) };
    case 'sticker':
      return { tipo: 'sticker', contenido: '[Sticker]' };
    case 'location': {
      const l = m.location;
      const coordenadas =
        l?.latitude !== undefined && l.longitude !== undefined
          ? `https://maps.google.com/?q=${l.latitude.toFixed(6)},${l.longitude.toFixed(6)}`
          : undefined;
      return { tipo: 'ubicacion', contenido: recortar(conTexto('[Ubicación]', l?.name, l?.address, coordenadas)) };
    }
    case 'contacts':
      return {
        tipo: 'contacto',
        contenido: recortar(conTexto('[Contacto]', ...(m.contacts ?? []).map((c) => c.name?.formatted_name))),
      };
    case 'reaction':
    case 'system':
    case 'request_welcome':
      return null;
    default:
      return { tipo: 'otro', contenido: '[Mensaje que no se puede mostrar]' };
  }
}

/**
 * Mensajes de clientes que trae un webhook (ya validado con WebhookWhatsAppSchema). Ignora los
 * avisos de estado (entregado, leído) y lo que no tenga la forma esperada.
 */
export function extraerMensajes(payload: z.infer<typeof WebhookWhatsAppSchema>): MensajeEntrante[] {
  const salida: MensajeEntrante[] = [];
  for (const entrada of payload.entry) {
    for (const cambio of entrada.changes) {
      if (cambio.field !== 'messages') continue;
      const valor = ValorSchema.safeParse(cambio.value);
      if (!valor.success) continue;
      const nombres = new Map((valor.data.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const crudo of valor.data.messages ?? []) {
        const m = MensajeMetaSchema.safeParse(crudo);
        if (!m.success) continue;
        const convertido = convertirMensaje(m.data);
        if (!convertido) continue;
        salida.push({
          phoneNumberId: valor.data.metadata.phone_number_id,
          waMessageId: m.data.id,
          telefono: m.data.from,
          nombre: nombres.get(m.data.from)?.trim().slice(0, 80) || null,
          ...convertido,
        });
      }
    }
  }
  return salida;
}

/**
 * Historial para la IA cuando llegaron varios mensajes sin interpretar ("hola", "2 completas",
 * "a Blandengues 450"): los ya interpretados van como contexto y los nuevos se juntan en uno
 * solo, que es el que la IA convierte en acciones. Así una ráfaga cuesta una sola llamada.
 */
export function historialWhatsApp(
  anteriores: readonly MensajeHistorial[],
  nuevos: readonly string[],
  maxAnteriores = 5,
): MensajeHistorial[] {
  const juntos = nuevos.join('\n').slice(0, MAX_MENSAJE_WA * 2);
  return [...anteriores.slice(-maxAnteriores), { rol: 'cliente', contenido: juntos }];
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** HMAC-SHA256 en hex. Meta firma el cuerpo crudo con el App Secret. */
export async function firmarHmac(cuerpo: Uint8Array<ArrayBuffer>, secreto: string): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return hex(await crypto.subtle.sign('HMAC', clave, cuerpo));
}

/**
 * Verifica el header X-Hub-Signature-256 ("sha256=<hex>") contra los bytes del cuerpo.
 * Comparación en tiempo constante. Sin secreto, nunca verifica.
 */
export async function verificarFirma(cuerpo: Uint8Array<ArrayBuffer>, header: string | null, secreto: string): Promise<boolean> {
  if (!secreto || !header?.startsWith('sha256=')) return false;
  const recibida = header.slice('sha256='.length).toLowerCase();
  const esperada = await firmarHmac(cuerpo, secreto);
  if (recibida.length !== esperada.length) return false;
  let diferencia = 0;
  for (let i = 0; i < esperada.length; i++) diferencia |= esperada.charCodeAt(i) ^ recibida.charCodeAt(i);
  return diferencia === 0;
}
