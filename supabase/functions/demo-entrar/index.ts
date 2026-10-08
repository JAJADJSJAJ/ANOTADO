// demo-entrar: crea la cuenta de un visitante de la demo pública (/demo) y le da cómo entrar.
//
// No hay login anónimo de Supabase: con el registro público apagado, Auth también lo bloquea, y
// prender el registro abriría la creación libre de cuentas. Acá la cuenta la crea el servidor:
//   1. Límite por IP (hasheada) y total, y tope de cuentas de demo vivas (consumir_limite_demo).
//   2. Cuenta con la API de administración: mail inventado en .invalid (nunca recibe nada),
//      sin contraseña, y app_metadata.demo = true (solo el servidor lo puede poner). La base no
//      la deja sumarse a locales reales ni cambiar su mail.
//   3. Cajero del local de demo (sumar_visitante_demo).
//   4. Un link de entrada generado acá (no se manda ningún mail): la web lo canjea por la sesión
//      con verifyOtp. El token sirve una sola vez y vence solo.
// La limpieza diaria borra las cuentas de demo de más de un día.

import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

function error(status: number, mensaje: string) {
  return Response.json({ error: mensaje }, { status });
}

/**
 * IP de quien llama, en sha256 (igual que registro). Se puede falsear: por eso además hay un
 * límite total y un tope de cuentas.
 */
async function hashIp(req: Request): Promise<string> {
  const ip =
    req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconocida';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    if (req.method !== 'POST') return error(405, 'Método no permitido');
    const admin = ctx.supabaseAdmin;

    // 1. Límite.
    const { data: dentro, error: errLimite } = await admin.rpc('consumir_limite_demo', { p_ip_hash: await hashIp(req) });
    if (errLimite) return error(500, 'No se pudo verificar el límite');
    if (!dentro) return error(429, 'Mucha gente probando la demo ahora: intentá en un minuto.');

    // 2. Cuenta de demo.
    const email = `visitante-${crypto.randomUUID()}@demo.anotado.invalid`;
    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { demo: true },
    });
    if (errCrear || !creado.user) {
      console.error('demo-entrar: no se pudo crear la cuenta', errCrear?.code ?? errCrear?.status);
      return error(500, 'No se pudo abrir la demo');
    }
    const userId = creado.user.id;
    const borrar = () => admin.auth.admin.deleteUser(userId).catch(() => undefined);

    // 3. Cajero del local de demo.
    const { data: demo, error: errSumar } = await admin.rpc('sumar_visitante_demo', { p_user_id: userId });
    if (errSumar || !demo) {
      await borrar();
      if (errSumar?.code === 'P0002') return error(503, 'La demo no está disponible en este momento');
      console.error('demo-entrar: no se pudo sumar a la demo', errSumar?.code);
      return error(500, 'No se pudo abrir la demo');
    }

    // 4. Link de entrada (sin mail).
    const { data: link, error: errLink } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const tokenHash = link?.properties?.hashed_token;
    if (errLink || !tokenHash) {
      await borrar();
      console.error('demo-entrar: no se pudo generar la entrada', errLink?.code ?? errLink?.status);
      return error(500, 'No se pudo abrir la demo');
    }
    return Response.json({ token_hash: tokenHash, slug: (demo as { slug: string }).slug });
  }),
};
