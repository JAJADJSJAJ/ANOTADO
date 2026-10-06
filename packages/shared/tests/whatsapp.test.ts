import { describe, expect, it } from 'vitest';
import {
  extraerMensajes,
  firmarHmac,
  historialWhatsApp,
  leerBytesAcotados,
  MAX_MENSAJE_WA,
  verificarFirma,
  WebhookWhatsAppSchema,
} from '../src/index.ts';

const payload = (messages: unknown[], extra: Record<string, unknown> = {}) =>
  WebhookWhatsAppSchema.parse({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: '100000000000001' },
              contacts: [{ wa_id: '59899000001', profile: { name: ' Ana ' } }],
              messages,
              ...extra,
            },
          },
        ],
      },
    ],
  });

const texto = (id: string, body: string, from = '59899000001') => ({ id, from, timestamp: '1', type: 'text', text: { body } });

describe('extraerMensajes', () => {
  it('saca el local, el cliente y el texto', () => {
    expect(extraerMensajes(payload([texto('wamid.1', ' 2 completas ')]))).toEqual([
      {
        phoneNumberId: '100000000000001',
        waMessageId: 'wamid.1',
        telefono: '59899000001',
        nombre: 'Ana',
        tipo: 'texto',
        contenido: '2 completas',
      },
    ]);
  });

  it('varios mensajes en el mismo webhook, en orden', () => {
    const r = extraerMensajes(payload([texto('a', 'hola'), texto('b', 'una coca')]));
    expect(r.map((m) => m.contenido)).toEqual(['hola', 'una coca']);
  });

  it('ignora avisos de estado (entregado, leído) y reacciones', () => {
    const conEstados = payload([], { statuses: [{ id: 'wamid.x', status: 'read' }] });
    expect(extraerMensajes(conEstados)).toEqual([]);
    const reaccion = { id: 'r', from: '59899000001', type: 'reaction', reaction: { emoji: '👍' } };
    expect(extraerMensajes(payload([reaccion]))).toEqual([]);
  });

  it('un mensaje mal formado no tira abajo a los demás', () => {
    const r = extraerMensajes(payload([{ id: 'malo', from: '+598 99', type: 'text' }, texto('bueno', 'hola')]));
    expect(r.map((m) => m.waMessageId)).toEqual(['bueno']);
  });

  it('ignora cambios que no son de mensajes', () => {
    const p = WebhookWhatsAppSchema.parse({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'account_update', value: {} }] }],
    });
    expect(extraerMensajes(p)).toEqual([]);
  });

  it('audios, fotos y ubicaciones quedan marcados para el cajero', () => {
    const r = extraerMensajes(
      payload([
        { id: '1', from: '59899000001', type: 'audio', audio: { id: 'm', voice: true } },
        { id: '2', from: '59899000001', type: 'image', image: { id: 'm', caption: 'esto' } },
        {
          id: '3',
          from: '59899000001',
          type: 'location',
          location: { latitude: -31.3833, longitude: -57.9667, name: 'Casa', address: 'Uruguay 123' },
        },
        { id: '4', from: '59899000001', type: 'sticker', sticker: { id: 'm' } },
        { id: '5', from: '59899000001', type: 'algo_nuevo' },
      ]),
    );
    expect(r.map((m) => [m.tipo, m.contenido])).toEqual([
      ['audio', '[Audio]'],
      ['imagen', '[Foto] esto'],
      ['ubicacion', '[Ubicación] Casa · Uruguay 123 · https://maps.google.com/?q=-31.383300,-57.966700'],
      ['sticker', '[Sticker]'],
      ['otro', '[Mensaje que no se puede mostrar]'],
    ]);
  });

  it('las respuestas a botones cuentan como texto', () => {
    const r = extraerMensajes(
      payload([{ id: '1', from: '59899000001', type: 'interactive', interactive: { button_reply: { id: 'x', title: 'Sí' } } }]),
    );
    expect(r[0]).toMatchObject({ tipo: 'texto', contenido: 'Sí' });
  });

  it('recorta mensajes larguísimos y descarta textos vacíos', () => {
    const r = extraerMensajes(payload([texto('largo', 'a'.repeat(5000)), texto('vacio', '   ')]));
    expect(r).toHaveLength(1);
    expect(r[0]!.contenido).toHaveLength(MAX_MENSAJE_WA);
  });

  it('sin nombre de perfil, nombre null', () => {
    const r = extraerMensajes(payload([texto('1', 'hola', '59899000002')]));
    expect(r[0]!.nombre).toBeNull();
  });

  it('rechaza payloads que no son de WhatsApp', () => {
    expect(WebhookWhatsAppSchema.safeParse({ object: 'page', entry: [] }).success).toBe(false);
  });
});

describe('historialWhatsApp', () => {
  it('junta los mensajes nuevos en uno y deja contexto acotado', () => {
    const anteriores = Array.from({ length: 8 }, (_, i) => ({ rol: 'cliente' as const, contenido: `m${i}` }));
    const h = historialWhatsApp(anteriores, ['hola', '2 completas']);
    expect(h).toHaveLength(6);
    expect(h[0]!.contenido).toBe('m3');
    expect(h.at(-1)).toEqual({ rol: 'cliente', contenido: 'hola\n2 completas' });
  });
});

describe('verificarFirma', () => {
  const cuerpo = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[]}');

  it('acepta la firma correcta', async () => {
    const firma = await firmarHmac(cuerpo, 'secreto');
    expect(await verificarFirma(cuerpo, `sha256=${firma}`, 'secreto')).toBe(true);
  });

  it('coincide con el vector de prueba del RFC 4231 (caso 2)', async () => {
    expect(await firmarHmac(new TextEncoder().encode('what do ya want for nothing?'), 'Jefe')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('rechaza otro secreto, cuerpo alterado, header ausente o mal formado', async () => {
    const firma = await firmarHmac(cuerpo, 'secreto');
    expect(await verificarFirma(cuerpo, `sha256=${firma}`, 'otro')).toBe(false);
    expect(await verificarFirma(new TextEncoder().encode('{}'), `sha256=${firma}`, 'secreto')).toBe(false);
    expect(await verificarFirma(cuerpo, null, 'secreto')).toBe(false);
    expect(await verificarFirma(cuerpo, firma, 'secreto')).toBe(false);
    expect(await verificarFirma(cuerpo, 'sha256=abc', 'secreto')).toBe(false);
  });

  it('sin secreto configurado nunca verifica', async () => {
    expect(await verificarFirma(cuerpo, `sha256=${'0'.repeat(64)}`, '')).toBe(false);
  });
});

describe('leerBytesAcotados', () => {
  it('devuelve los bytes tal cual y corta si se pasa', async () => {
    const bytes = new Uint8Array([0xe2, 0x82, 0xac, 0x7b]);
    expect(await leerBytesAcotados(new Response(bytes).body, 10)).toEqual(bytes);
    expect(await leerBytesAcotados(new Response(bytes).body, 3)).toBeNull();
  });
});
