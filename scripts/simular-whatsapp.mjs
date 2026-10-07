// Simula a Meta mandando mensajes de WhatsApp al webhook, con la misma forma y la misma firma
// (HMAC-SHA256 del cuerpo con el App Secret). Sin dependencias.
//
// Uso (local, con `pnpm supabase functions serve` corriendo):
//   node scripts/simular-whatsapp.mjs "hola" "mandame 2 completas" "a blandengues 450"
//   node scripts/simular-whatsapp.mjs --telefono 59899000002 --nombre Beto "una muzza"
//   node scripts/simular-whatsapp.mjs --audio            (un audio: no se interpreta)
//   node scripts/simular-whatsapp.mjs --repetir "hola"   (manda dos veces lo mismo: dedupe)
//   node scripts/simular-whatsapp.mjs --juntos "a" "b"   (todos en un solo webhook)
//   node scripts/simular-whatsapp.mjs --pruebas          (firma mala, sin firma, verificación GET)
//
// Variables (opcionales): WA_APP_SECRET y WA_VERIFY_TOKEN (por defecto, los de
// supabase/functions/.env.example para local), WEBHOOK_URL (por defecto el local) y
// WA_PHONE_NUMBER_ID (por defecto El Ceibo del seed).
// En la nube no hace falta: la prueba real es escribirle al número de prueba de Meta.

import { createHmac, randomUUID } from 'node:crypto';

const URL_WEBHOOK = process.env.WEBHOOK_URL ?? 'http://127.0.0.1:54321/functions/v1/whatsapp-webhook';
const SECRETO = process.env.WA_APP_SECRET ?? 'secreto-local-solo-para-pruebas';
const VERIFY = process.env.WA_VERIFY_TOKEN ?? 'verify-local-solo-para-pruebas';
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID ?? '100000000000001';

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  if (i < 0) return porDefecto;
  const [valor] = args.splice(i, 2).slice(1);
  return valor;
};
const bandera = (nombre) => {
  const i = args.indexOf(nombre);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};

const telefono = opcion('--telefono', '59899000001');
const nombre = opcion('--nombre', 'Cliente de prueba');
const audio = bandera('--audio');
const repetir = bandera('--repetir');
const juntos = bandera('--juntos');
const pruebas = bandera('--pruebas');

const mensajeTexto = (texto) => ({
  from: telefono,
  id: `wamid.SIM${randomUUID().replaceAll('-', '')}`,
  timestamp: String(Math.floor(Date.now() / 1000)),
  type: 'text',
  text: { body: texto },
});
const mensajeAudio = () => ({
  from: telefono,
  id: `wamid.SIM${randomUUID().replaceAll('-', '')}`,
  timestamp: String(Math.floor(Date.now() / 1000)),
  type: 'audio',
  audio: { id: 'media-de-prueba', mime_type: 'audio/ogg; codecs=opus', voice: true },
});

const payload = (messages) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_SIMULADA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550000000', phone_number_id: PHONE_NUMBER_ID },
            contacts: [{ profile: { name: nombre }, wa_id: telefono }],
            messages,
          },
        },
      ],
    },
  ],
});

async function enviar(cuerpo, { firma = 'buena' } = {}) {
  const texto = JSON.stringify(cuerpo);
  const headers = { 'content-type': 'application/json' };
  if (firma === 'buena') headers['x-hub-signature-256'] = `sha256=${createHmac('sha256', SECRETO).update(texto).digest('hex')}`;
  if (firma === 'mala') headers['x-hub-signature-256'] = `sha256=${createHmac('sha256', 'otro').update(texto).digest('hex')}`;
  const r = await fetch(URL_WEBHOOK, { method: 'POST', headers, body: texto });
  return r.status;
}

if (pruebas) {
  let fallas = 0;
  const ok = (cond, texto, detalle) => {
    console.log(`${cond ? '✔' : '✘'} ${texto} (${detalle})`);
    if (!cond) fallas++;
  };
  const p = payload([mensajeTexto('esto no tiene que guardarse')]);
  ok((await enviar(p, { firma: 'mala' })) === 401, 'firma con otro secreto: 401', 'no se guarda');
  ok((await enviar(p, { firma: 'ninguna' })) === 401, 'sin firma: 401', 'no se guarda');
  const desafio = 'desafio123';
  const bien = await fetch(`${URL_WEBHOOK}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY)}&hub.challenge=${desafio}`);
  ok(bien.status === 200 && (await bien.text()) === desafio, 'verificación de Meta con el token correcto', bien.status);
  const mal = await fetch(`${URL_WEBHOOK}?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=${desafio}`);
  ok(mal.status === 403, 'verificación con otro token: 403', mal.status);
  const otro = await enviar({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [] } }] }] });
  ok(otro === 200, 'aviso de estado (leído/entregado): 200 sin guardar nada', otro);
  process.exitCode = fallas ? 1 : 0;
} else {
  await simular();
}

async function simular() {
  const mensajes = [...(audio ? [mensajeAudio()] : []), ...args.map(mensajeTexto)];
  if (mensajes.length === 0) {
    console.error('Pasá al menos un mensaje, o --audio, o --pruebas. Mirá el encabezado del script.');
    process.exitCode = 1;
    return;
  }
  // Por defecto, un webhook por mensaje y seguidos (como una ráfaga real del cliente).
  const tandas = juntos ? [mensajes] : mensajes.map((m) => [m]);
  for (const tanda of tandas) {
    const cuerpo = payload(tanda);
    const estado = await enviar(cuerpo);
    console.log(`${estado === 200 ? '✔' : '✘'} ${tanda.length} mensaje(s) → ${estado}`);
    if (repetir) console.log(`  reintento (como Meta): ${await enviar(cuerpo)}`);
  }
}
