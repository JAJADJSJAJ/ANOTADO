// Verifica parse-order desplegada (local o nube) con sesiones reales. Sin dependencias.
//
// Qué prueba:
//   1. La función arranca y cargó packages/shared: responde con mensajes propios, no del
//      gateway (un 401 sin sesión solo prueba el gateway).
//   2. Cocina no puede usarla (403 por rol).
//   3. Con la IA apagada o no permitida responde 403 SIN registrar uso de IA.
//   4. En la nube: que el registro público esté desactivado.
//   5. Con --con-ia: una interpretación real (LLAMADA PAGA, revisá el saldo antes).
//
// Uso: copiá scripts/verificacion.env.example a scripts/.env.verificacion (ignorado por git),
// completalo y corré:
//   node --env-file=scripts/.env.verificacion scripts/verificar-parse-order.mjs [--con-ia]
//
// El límite de uso (limites_ia) no lo puede leer ningún usuario: para confirmar que no se
// consumió, mirá `select * from limites_ia` en el SQL Editor antes y después.

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta la variable ${k}`);
  return v;
};
const URL_BASE = env('SUPABASE_URL').replace(/\/$/, '');
const KEY = env('SUPABASE_PUBLISHABLE_KEY');
const CON_IA = process.argv.includes('--con-ia');

let fallas = 0;
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '✔' : '✘'} ${texto}${detalle ? ` (${detalle})` : ''}`);
  if (!cond) fallas++;
};

async function sesion(email, password) {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`No se pudo entrar como ${email}: ${d.error_description ?? d.msg ?? r.status}`);
  return d.access_token;
}

const rest = (token, ruta, init = {}) =>
  fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });

async function parseOrder(token, negocioId, mensaje = 'una hamburguesa completa') {
  const r = await fetch(`${URL_BASE}/functions/v1/parse-order`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ negocio_id: negocioId, mensaje }),
  });
  let cuerpo = null;
  try {
    cuerpo = await r.json();
  } catch {
    /* sin JSON */
  }
  return { status: r.status, error: cuerpo?.error ?? null, cuerpo };
}

async function usoIA(token, negocioId) {
  const r = await rest(token, `uso_ia?select=id&negocio_id=eq.${negocioId}`, { headers: { Prefer: 'count=exact' } });
  return Number(r.headers.get('content-range')?.split('/')[1] ?? NaN);
}

const dueno = await sesion(env('DUENO_EMAIL'), env('DUENO_PASS'));
const cocina = await sesion(env('COCINA_EMAIL'), env('COCINA_PASS'));

const r = await rest(dueno, `negocios?select=id,ia_permitida,ia_activa&slug=eq.${env('NEGOCIO')}`);
const [negocio] = await r.json();
if (!negocio) throw new Error('El dueño no ve ese negocio');

const sinSesion = await parseOrder(null, negocio.id);
ok(sinSesion.status === 401, 'sin sesión: 401', `HTTP ${sinSesion.status}`);

const deCocina = await parseOrder(cocina, negocio.id);
ok(
  deCocina.status === 403 && deCocina.error === 'Sin permiso en este negocio',
  'la función arranca (shared cargado) y cocina recibe 403 por rol',
  `HTTP ${deCocina.status}: ${deCocina.error}`,
);

const usoAntes = await usoIA(dueno, negocio.id);
if (!negocio.ia_permitida) {
  const res = await parseOrder(dueno, negocio.id);
  ok(res.status === 403 && /no está habilitada/.test(res.error ?? ''), 'IA no permitida: 403', `HTTP ${res.status}: ${res.error}`);
} else {
  // Apagar ia_activa como dueño, probar y dejarla como estaba.
  await rest(dueno, `negocios?id=eq.${negocio.id}`, { method: 'PATCH', body: JSON.stringify({ ia_activa: false }) });
  try {
    const res = await parseOrder(dueno, negocio.id);
    ok(res.status === 403 && /apagada/.test(res.error ?? ''), 'IA apagada por el dueño: 403', `HTTP ${res.status}: ${res.error}`);
  } finally {
    await rest(dueno, `negocios?id=eq.${negocio.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ia_activa: negocio.ia_activa }),
    });
  }
}
ok((await usoIA(dueno, negocio.id)) === usoAntes, 'con la IA cortada no se registró uso de IA');

const intento = await rest(dueno, `negocios?id=eq.${negocio.id}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ ia_permitida: !negocio.ia_permitida }),
});
ok(intento.status === 401 || intento.status === 403, 'el dueño no puede cambiar ia_permitida', `HTTP ${intento.status}`);

// Registro público: en la nube tiene que estar apagado (en local está abierto a propósito).
// Se lee de /auth/v1/settings, que lo informa sin crear ninguna cuenta: un intento de
// registro fallido podría confundirse con otro error y, si el registro estuviera abierto,
// dejaría un usuario creado.
const local = /127\.0\.0\.1|localhost/.test(URL_BASE);
if (!local) {
  const r = await fetch(`${URL_BASE}/auth/v1/settings`, { headers: { apikey: KEY } });
  const ajustes = r.ok ? await r.json() : null;
  ok(ajustes?.disable_signup === true, 'registro público desactivado', `disable_signup = ${ajustes?.disable_signup}`);
}

if (CON_IA) {
  if (!negocio.ia_permitida || !negocio.ia_activa) {
    ok(false, '--con-ia necesita la IA permitida y prendida en ese negocio');
  } else {
    const res = await parseOrder(dueno, negocio.id, 'hola, mandame 2 completas sin tomate');
    ok(res.status === 200 && res.cuerpo?.borrador, 'interpretación real: 200 con borrador', `HTTP ${res.status}: ${res.error ?? 'ok'}`);
    ok((await usoIA(dueno, negocio.id)) === usoAntes + 1, 'registró el uso de IA');
    // La tarjeta de prueba queda abierta en el mostrador: descartala desde ahí.
  }
}

console.log(fallas === 0 ? '\nTodo OK' : `\n${fallas} verificación(es) fallaron`);
process.exit(fallas === 0 ? 0 : 1);
