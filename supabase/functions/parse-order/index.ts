// parse-order: interpreta un mensaje de cliente y actualiza el borrador de la conversación.
//
// El pedido NUNCA se crea acá: la IA propone, el cajero revisa y confirma con la RPC
// confirmar_pedido. Flujo:
//   1. Solicitud: POST, JSON, tamaño acotado, configuración de IA válida.
//   2. JWT válido (withSupabase) y rol dueño/cajero en el negocio.
//   3. Límite atómico por usuario y por negocio (consumir_limite_ia).
//   4. Lecturas: menú activo, conversación (del negocio, abierta, versión) e historial.
//   5. IA sin escribir nada: timeout 15 s y un reintento (llamarIA), respuesta validada con Zod.
//   6. Reducer de shared: valida productos, cantidades y largos acción por acción.
//   7. Una sola transacción (guardar_interpretacion): mensaje, borrador, pendientes, uso de IA.
//      Si otro mensaje se guardó en el medio (versión distinta), se rechaza con 409.
//
// Si algo falla antes del paso 7, no queda nada escrito: el cajero conserva el texto en
// pantalla y puede reintentar sin duplicar mensajes.
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
const MAX_PENDIENTES = 30;
const MAX_CUERPO_BYTES = 32 * 1024;
const LIMITE_POR_USUARIO = 20; // por minuto
const LIMITE_POR_NEGOCIO = 60; // por minuto
const SIN_PENDIENTES: Pendientes = { dudosos: [], preguntas: [], errores: [] };

const EntradaSchema = z.object({
  negocio_id: z.uuid(),
  /** null = conversación nueva (tarjeta nueva). */
  conversacion_id: z.uuid().nullable().default(null),
  /** Versión de la conversación que tiene la pantalla. Si la base tiene otra, 409. */
  version: z.int().min(0).optional(),
  mensaje: z.string().trim().min(1).max(2000),
  etiqueta: z.string().trim().max(40).optional(),
  /** Borrador tal como lo dejó el cajero (pudo editarlo a mano). Se revalida contra el menú. */
  borrador: BorradorSchema.optional(),
  pendientes: PendientesSchema.optional(),
});

function error(status: number, mensaje: string) {
  return Response.json({ error: mensaje }, { status });
}

/** Lee y valida la configuración de IA. Un IA_EXTRA mal formado no rompe la función. */
function leerConfigIA(): ConfigIA | string {
  const baseUrl = Deno.env.get('IA_BASE_URL');
  const apiKey = Deno.env.get('IA_API_KEY');
  const modelo = Deno.env.get('IA_MODELO');
  if (!baseUrl || !apiKey || !modelo) return 'faltan IA_BASE_URL, IA_API_KEY o IA_MODELO';
  if (!/^https?:\/\//.test(baseUrl)) return 'IA_BASE_URL no es una URL http(s)';
  let cuerpoExtra: Record<string, unknown> | undefined;
  const extra = Deno.env.get('IA_EXTRA');
  if (extra) {
    try {
      const valor = JSON.parse(extra);
      if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return 'IA_EXTRA no es un objeto JSON';
      cuerpoExtra = valor;
    } catch {
      return 'IA_EXTRA no es JSON válido';
    }
  }
  return {
    baseUrl,
    apiKey,
    modelo,
    formato: Deno.env.get('IA_FORMATO') === 'json_schema' ? 'json_schema' : 'json_object',
    cuerpoExtra,
    headers: { 'X-Title': 'Anotado' },
  };
}

/** Cuerpo JSON con tamaño máximo (no se confía en Content-Length). */
async function leerCuerpo(req: Request): Promise<unknown> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
  const texto = await req.text();
  if (new TextEncoder().encode(texto).length > MAX_CUERPO_BYTES) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    // 1. Solicitud y configuración.
    if (req.method !== 'POST') return error(405, 'Método no permitido');
    const config = leerConfigIA();
    if (typeof config === 'string') {
      console.error(`parse-order: configuración de IA inválida: ${config}`);
      return error(500, 'La IA no está configurada');
    }
    const entrada = EntradaSchema.safeParse(await leerCuerpo(req));
    if (!entrada.success) return error(400, 'Datos inválidos');
    const { negocio_id, mensaje, etiqueta } = entrada.data;

    // 2. Rol, con el cliente del usuario: tiene_rol usa auth.uid() de quien llama.
    const userId = ctx.userClaims?.id;
    if (!userId) return error(401, 'Sesión inválida');
    const { data: puede, error: errRol } = await ctx.supabase.rpc('tiene_rol', {
      n: negocio_id,
      roles: ['dueno', 'cajero'],
    });
    if (errRol) return error(500, 'No se pudo verificar el permiso');
    if (!puede) return error(403, 'Sin permiso en este negocio');

    // Desde acá, service_role (salta RLS): TODAS las consultas filtran por negocio_id.
    const admin = ctx.supabaseAdmin;

    // 3. Límite atómico (por usuario y por negocio).
    const { data: dentroDelLimite, error: errLimite } = await admin.rpc('consumir_limite_ia', {
      p_negocio_id: negocio_id,
      p_user_id: userId,
      p_max_negocio: LIMITE_POR_NEGOCIO,
      p_max_usuario: LIMITE_POR_USUARIO,
    });
    if (errLimite) return error(500, 'No se pudo verificar el límite de uso');
    if (!dentroDelLimite) return error(429, 'Demasiados mensajes seguidos, esperá un minuto');

    // 4a. Menú del negocio.
    const { data: productos, error: errMenu } = await admin
      .from('productos')
      .select('id, nombre, alias, activo')
      .eq('negocio_id', negocio_id);
    if (errMenu || !productos) return error(500, 'No se pudo cargar el menú');
    const { texto: menuTexto, menu } = construirMenu(productos);

    // 4b. Conversación existente: del negocio, abierta, y la pantalla no está desactualizada.
    const conversacionId = entrada.data.conversacion_id;
    let version: number | null = null;
    let borradorGuardado: unknown = null;
    let pendientesGuardados: unknown = null;
    let historial: MensajeHistorial[] = [];
    if (conversacionId) {
      const { data: conv, error: errConv } = await admin
        .from('conversaciones')
        .select('estado, version, borrador, pendientes')
        .eq('id', conversacionId)
        .eq('negocio_id', negocio_id)
        .maybeSingle();
      if (errConv) return error(500, 'No se pudo cargar la conversación');
      if (!conv || conv.estado !== 'abierta') return error(409, 'La conversación no existe o ya está cerrada');
      if (entrada.data.version !== undefined && entrada.data.version !== conv.version) {
        return error(409, 'Esta tarjeta cambió en otra pantalla. Recargá la página.');
      }
      version = conv.version;
      borradorGuardado = conv.borrador;
      pendientesGuardados = conv.pendientes;

      const { data: previos, error: errHist } = await admin
        .from('mensajes')
        .select('rol, contenido')
        .eq('conversacion_id', conversacionId)
        .eq('negocio_id', negocio_id)
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORIAL - 1);
      if (errHist) return error(500, 'No se pudo cargar el historial');
      historial = (previos ?? []).reverse();
    }
    historial.push({ rol: 'cliente', contenido: mensaje });

    // Borrador de partida: el de la pantalla si vino, si no el guardado. Solo productos activos
    // de ESTE negocio (el navegador no es confiable). No hay precios: los pone confirmar_pedido.
    const activos = new Set(menu.map((p) => p.id));
    const base: Borrador = entrada.data.borrador ?? BorradorSchema.catch(borradorVacio()).parse(borradorGuardado ?? {});
    const quitados = base.items.filter((it) => !activos.has(it.producto_id)).length;
    const borradorInicial: Borrador = { ...base, items: base.items.filter((it) => activos.has(it.producto_id)) };
    const pendientesPrevios = entrada.data.pendientes ?? PendientesSchema.catch(SIN_PENDIENTES).parse(pendientesGuardados ?? {});

    // 5. IA (no escribe nada).
    let resultado;
    try {
      resultado = await llamarIA(config, construirMensajes(menuTexto, menu, borradorInicial, historial));
    } catch (e) {
      console.error('parse-order: falla de IA', e instanceof ErrorIA ? e.message.slice(0, 200) : 'desconocida');
      return error(502, 'No se pudo interpretar el mensaje. Probá de nuevo o cargalo a mano.');
    }

    // 6. Reducer.
    const aplicado = aplicarAcciones(borradorInicial, resultado.respuesta.acciones, menu);
    // dudosos y preguntas se acumulan hasta que el cajero los resuelve; errores son solo los
    // de este mensaje (los anteriores ya se mostraron). Todo acotado a MAX_PENDIENTES.
    const pendientes: Pendientes = {
      dudosos: [...pendientesPrevios.dudosos, ...aplicado.dudosos].slice(-MAX_PENDIENTES),
      preguntas: [...pendientesPrevios.preguntas, ...aplicado.preguntas].slice(-MAX_PENDIENTES),
      errores: [
        ...(quitados ? [`${quitados} producto(s) ya no están disponibles y se sacaron del pedido`] : []),
        ...aplicado.errores,
      ].slice(-MAX_PENDIENTES),
    };

    // 7. Todo junto, en una transacción.
    const { data: guardado, error: errGuardar } = await admin
      .rpc('guardar_interpretacion', {
        p_negocio_id: negocio_id,
        p_conversacion_id: conversacionId,
        p_version: version,
        p_etiqueta: etiqueta ?? null,
        p_mensaje: mensaje,
        p_borrador: aplicado.borrador,
        p_pendientes: pendientes,
        p_modelo: resultado.modelo,
        p_tokens_entrada: resultado.tokensEntrada,
        p_tokens_salida: resultado.tokensSalida,
      })
      .single();
    if (errGuardar || !guardado) {
      if (errGuardar?.code === '40001') return error(409, 'Llegó otro mensaje a esta tarjeta al mismo tiempo. Probá de nuevo.');
      if (errGuardar?.code === '22023') return error(409, 'La conversación no existe o ya está cerrada');
      console.error('parse-order: no se pudo guardar', errGuardar?.code);
      return error(500, 'No se pudo guardar el resultado. Probá de nuevo.');
    }

    return Response.json({
      conversacion_id: guardado.conversacion_id,
      version: guardado.version,
      borrador: aplicado.borrador,
      pendientes,
      /** Solo lo de este mensaje, para resaltarlo en pantalla. */
      nuevos: { dudosos: aplicado.dudosos, preguntas: aplicado.preguntas },
      listo_para_confirmar: resultado.respuesta.listo_para_confirmar,
    });
  }),
};
