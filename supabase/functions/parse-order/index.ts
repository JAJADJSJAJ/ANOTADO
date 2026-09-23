// parse-order: interpreta un mensaje de cliente y actualiza el borrador de la conversación.
//
// El pedido NUNCA se crea acá: la IA propone, el cajero revisa y confirma con la RPC
// confirmar_pedido. Pasos (ANOTADO.md § 7):
//   1. JWT válido (withSupabase) y rol dueño/cajero en el negocio.
//   2. Límite de llamadas por negocio y minuto.
//   3. Conversación (existente y abierta, o nueva), menú activo, últimos mensajes.
//   4. Guardar el mensaje.
//   5. IA: timeout 15 s, un reintento, respuesta validada con Zod. Si falla, no se toca nada.
//   6. Aplicar acciones con el reducer de shared (valida productos, cantidades, largos).
//   7. Guardar borrador y pendientes; registrar tokens en uso_ia.
//
// Privacidad (Ley 18.331): nunca se loguea el contenido de los mensajes.

import '@supabase/functions-js/edge-runtime.d.ts';
import {
  aplicarAcciones,
  type Borrador,
  BorradorSchema,
  borradorVacio,
  type ConfigIA,
  construirMensajes,
  construirMenu,
  ErrorIA,
  llamarIA,
  type MensajeHistorial,
  type Pendientes,
  PendientesSchema,
} from '@anotado/shared';
import { withSupabase } from '@supabase/server';
import { z } from 'zod';

const MAX_HISTORIAL = 6;
const LLAMADAS_POR_MINUTO = 30;
const MAX_PENDIENTES = 30;

const EntradaSchema = z.object({
  negocio_id: z.uuid(),
  /** null = conversación nueva (tarjeta nueva). */
  conversacion_id: z.uuid().nullable().default(null),
  mensaje: z.string().trim().min(1).max(2000),
  etiqueta: z.string().trim().max(40).optional(),
  /** Estado actual de la tarjeta tal como lo dejó el cajero (puede haberlo editado a mano). */
  borrador: BorradorSchema.optional(),
  pendientes: PendientesSchema.optional(),
});

function error(status: number, mensaje: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error: mensaje, ...extra }, { status });
}

function configIA(): ConfigIA | null {
  const baseUrl = Deno.env.get('IA_BASE_URL');
  const apiKey = Deno.env.get('IA_API_KEY');
  const modelo = Deno.env.get('IA_MODELO');
  if (!baseUrl || !apiKey || !modelo) return null;
  const extra = Deno.env.get('IA_EXTRA');
  return {
    baseUrl,
    apiKey,
    modelo,
    formato: Deno.env.get('IA_FORMATO') === 'json_schema' ? 'json_schema' : 'json_object',
    cuerpoExtra: extra ? JSON.parse(extra) : undefined,
    headers: { 'X-Title': 'Anotado' },
  };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return error(405, 'Método no permitido');

    const config = configIA();
    if (!config) {
      console.error('parse-order: faltan IA_BASE_URL / IA_API_KEY / IA_MODELO');
      return error(500, 'La IA no está configurada');
    }

    const entrada = EntradaSchema.safeParse(await req.json().catch(() => null));
    if (!entrada.success) return error(400, 'Datos inválidos');
    const { negocio_id, mensaje, etiqueta } = entrada.data;

    // 1. Rol: se consulta con el cliente del usuario, así auth.uid() es quien llama.
    const { data: puede, error: errRol } = await ctx.supabase.rpc('tiene_rol', {
      n: negocio_id,
      roles: ['dueno', 'cajero'],
    });
    if (errRol || !puede) return error(403, 'Sin permiso en este negocio');

    // Desde acá, service_role (salta RLS): todas las consultas filtran por negocio_id.
    const admin = ctx.supabaseAdmin;

    // 2. Límite por negocio. Cuenta mensajes (se guardan siempre, aunque la IA falle), así
    // provocar errores no sirve para saltearlo.
    const haceUnMinuto = new Date(Date.now() - 60_000).toISOString();
    const { count } = await admin
      .from('mensajes')
      .select('id', { count: 'exact', head: true })
      .eq('negocio_id', negocio_id)
      .eq('rol', 'cliente')
      .gte('created_at', haceUnMinuto);
    if ((count ?? 0) >= LLAMADAS_POR_MINUTO) return error(429, 'Demasiados mensajes seguidos, esperá un momento');

    // 3a. Conversación.
    let conversacionId = entrada.data.conversacion_id;
    let borradorGuardado: unknown;
    let pendientesGuardados: unknown;
    if (conversacionId) {
      const { data: conv } = await admin
        .from('conversaciones')
        .select('id, estado, borrador, pendientes')
        .eq('id', conversacionId)
        .eq('negocio_id', negocio_id)
        .maybeSingle();
      if (!conv || conv.estado !== 'abierta') return error(409, 'La conversación no existe o ya está cerrada');
      borradorGuardado = conv.borrador;
      pendientesGuardados = conv.pendientes;
    } else {
      const { data: nueva, error: errNueva } = await admin
        .from('conversaciones')
        .insert({ negocio_id, etiqueta: etiqueta || null })
        .select('id')
        .single();
      if (errNueva || !nueva) return error(500, 'No se pudo crear la conversación');
      conversacionId = nueva.id;
    }

    // 3b. Menú del negocio.
    const { data: productos, error: errMenu } = await admin
      .from('productos')
      .select('id, nombre, alias, activo')
      .eq('negocio_id', negocio_id);
    if (errMenu || !productos) return error(500, 'No se pudo cargar el menú');
    const { texto: menuTexto, menu } = construirMenu(productos);

    // Borrador de partida: el de la pantalla si vino (el cajero pudo editarlo), si no el guardado.
    // Solo se conservan productos activos de ESTE negocio: el cliente del navegador no es confiable.
    const activos = new Set(menu.map((p) => p.id));
    const base: Borrador = entrada.data.borrador ?? BorradorSchema.catch(borradorVacio()).parse(borradorGuardado ?? {});
    const quitados = base.items.filter((it) => !activos.has(it.producto_id)).length;
    const borradorInicial: Borrador = { ...base, items: base.items.filter((it) => activos.has(it.producto_id)) };
    const pendientesPrevios: Pendientes =
      entrada.data.pendientes ?? PendientesSchema.catch({ dudosos: [], preguntas: [], errores: [] }).parse(pendientesGuardados ?? {});

    // 3c. Últimos mensajes (el nuevo va al final).
    const { data: previos } = await admin
      .from('mensajes')
      .select('rol, contenido')
      .eq('conversacion_id', conversacionId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORIAL - 1);
    const historial: MensajeHistorial[] = [...(previos ?? []).reverse(), { rol: 'cliente', contenido: mensaje }];

    // 4. Guardar el mensaje (queda aunque la IA falle: el cajero no pierde lo pegado).
    await admin.from('mensajes').insert({ negocio_id, conversacion_id: conversacionId, rol: 'cliente', contenido: mensaje });

    // 5. IA.
    let resultado;
    try {
      resultado = await llamarIA(config, construirMensajes(menuTexto, menu, borradorInicial, historial));
    } catch (e) {
      console.error('parse-order: falla de IA', e instanceof ErrorIA ? e.message.slice(0, 200) : 'desconocida');
      await admin.from('conversaciones').update({ ultimo_mensaje_at: new Date().toISOString() }).eq('id', conversacionId);
      return error(502, 'No se pudo interpretar el mensaje. Probá de nuevo o cargalo a mano.', {
        conversacion_id: conversacionId,
      });
    }

    // 6. Aplicar acciones (el reducer rechaza lo inválido).
    const aplicado = aplicarAcciones(borradorInicial, resultado.respuesta.acciones, menu);
    const errores = [
      ...(quitados ? [`${quitados} producto(s) ya no están disponibles y se sacaron del pedido`] : []),
      ...aplicado.errores,
    ];
    const pendientes: Pendientes = {
      dudosos: [...pendientesPrevios.dudosos, ...aplicado.dudosos].slice(-MAX_PENDIENTES),
      preguntas: [...pendientesPrevios.preguntas, ...aplicado.preguntas].slice(-MAX_PENDIENTES),
      errores: errores.slice(-MAX_PENDIENTES),
    };

    // 7. Guardar y registrar uso.
    await admin
      .from('conversaciones')
      .update({
        borrador: aplicado.borrador,
        pendientes,
        ultimo_mensaje_at: new Date().toISOString(),
        ...(etiqueta !== undefined && { etiqueta: etiqueta || null }),
      })
      .eq('id', conversacionId);
    await admin.from('uso_ia').insert({
      negocio_id,
      conversacion_id: conversacionId,
      modelo: resultado.modelo,
      tokens_entrada: resultado.tokensEntrada,
      tokens_salida: resultado.tokensSalida,
    });

    return Response.json({
      conversacion_id: conversacionId,
      borrador: aplicado.borrador,
      pendientes,
      /** Solo lo de este mensaje, para resaltarlo en pantalla. */
      nuevos: { dudosos: aplicado.dudosos, preguntas: aplicado.preguntas },
      listo_para_confirmar: resultado.respuesta.listo_para_confirmar,
    });
  }),
};
