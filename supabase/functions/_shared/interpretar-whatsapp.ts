// Interpreta los mensajes de WhatsApp pendientes de una conversación.
//
// Lo usan whatsapp-webhook (en segundo plano, después de contestarle 200 a Meta) y parse-order
// (botón "Interpretar" del mostrador, cuando la IA estaba apagada o falló).
//
//   1. Turno (tomar_conversacion_wa): un solo proceso por conversación. Si otro lo tiene, este
//      no hace nada: el que lo tiene vuelve a mirar antes de soltarlo.
//   2. Espera corta: los clientes mandan ráfagas ("hola" / "2 completas" / "a Blandengues
//      450"); esperar un poco las junta en una sola llamada a la IA.
//   3. Lee los mensajes de texto sin interpretar, el borrador guardado (incluye lo que editó el
//      cajero) y el contexto. Llama a la IA SIN escribir nada.
//   4. guardar_interpretacion_wa marca como interpretados solo esos mensajes y guarda, en la
//      misma transacción, lo que el bot le contesta al cliente (plantillas: shared/bot.ts). Si
//      el cajero editó en el medio (40001), vuelve a empezar sobre lo nuevo.
//   5. Al soltar el turno, si quedó algo pendiente (llegó justo), lo vuelve a tomar.
// Si la IA está apagada, se pasó el límite o falla, los mensajes quedan sin interpretar y el
// cajero los ve igual. Privacidad (Ley 18.331): nunca se loguean mensajes ni teléfonos.

import {
  aplicarAcciones,
  type Borrador,
  BorradorSchema,
  borradorVacio,
  type ConfigIA,
  construirMensajes,
  construirMenu,
  type Cancelacion,
  ErrorIA,
  historialWhatsApp,
  leerPagos,
  llamarIA,
  type MensajeHistorial,
  type PedidoDelCliente,
  type Pendientes,
  PendientesSchema,
  respuestaBot,
} from '@anotado/shared';
import type { SupabaseContext } from '@supabase/server';

type Admin = SupabaseContext['supabaseAdmin'];

export const LIMITE_IA_NEGOCIO = 60; // por minuto, compartido con parse-order
export const LIMITE_IA_CLIENTE = 10; // por minuto y por cliente de WhatsApp
const TURNO_SEGUNDOS = 90;
const ESPERA_RAFAGA_MS = 2500;
const MAX_DURACION_MS = 60_000;
const MAX_VUELTAS = 4;
const MAX_TOMAS = 3;
const MAX_PENDIENTES = 30;
const MAX_MENSAJES_POR_VUELTA = 20;
const SIN_PENDIENTES: Pendientes = { dudosos: [], preguntas: [], errores: [] };

export type ResultadoInterpretacion =
  | 'ok' // se interpretó al menos una tanda
  | 'nada' // no había nada pendiente (o la conversación se cerró)
  | 'ocupada' // otro proceso tiene el turno
  | 'ia_apagada'
  | 'limite'
  | 'error_ia'
  | 'error';

type Opciones = {
  /** Esperar la ráfaga antes de la primera llamada (webhook sí, botón del cajero no). */
  esperarRafaga: boolean;
  /** El webhook consume el límite por cliente; parse-order ya consumió el del usuario. */
  consumirLimite: boolean;
};

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * dudosos y preguntas se acumulan hasta que el cajero los resuelve; errores son solo los de esta
 * interpretación. Todo acotado. La usan parse-order y el intérprete de WhatsApp.
 */
export function combinarPendientes(
  previos: Pendientes,
  nuevos: { dudosos: string[]; preguntas: string[]; errores: string[] },
  quitados: number,
): Pendientes {
  return {
    dudosos: [...previos.dudosos, ...nuevos.dudosos].slice(-MAX_PENDIENTES),
    preguntas: [...previos.preguntas, ...nuevos.preguntas].slice(-MAX_PENDIENTES),
    errores: [
      ...(quitados ? [`${quitados} producto(s) ya no están disponibles y se sacaron del pedido`] : []),
      ...nuevos.errores,
    ].slice(-MAX_PENDIENTES),
  };
}

export async function interpretarConversacion(
  admin: Admin,
  config: ConfigIA,
  negocioId: string,
  conversacionId: string,
  opciones: Opciones,
): Promise<ResultadoInterpretacion> {
  const ids = { p_negocio_id: negocioId, p_conversacion_id: conversacionId };
  let resultado: ResultadoInterpretacion = 'nada';
  for (let toma = 0; toma < MAX_TOMAS; toma++) {
    const { data: tomada, error } = await admin.rpc('tomar_conversacion_wa', { ...ids, p_segundos: TURNO_SEGUNDOS });
    if (error) return 'error';
    if (!tomada) return toma === 0 ? 'ocupada' : resultado;

    let quedan = false;
    try {
      resultado = await vueltas(admin, config, negocioId, conversacionId, { ...opciones, esperarRafaga: opciones.esperarRafaga && toma === 0 });
    } finally {
      const { data } = await admin.rpc('soltar_conversacion_wa', ids);
      quedan = data === true;
    }
    // Si llegó algo justo antes de soltar, nadie más lo va a tomar: se sigue. Si se cortó por
    // IA apagada, límite o error, no (quedaría dando vueltas): el cajero lo ve y decide.
    if (!quedan || (resultado !== 'ok' && resultado !== 'nada')) break;
  }
  return resultado;
}

async function vueltas(
  admin: Admin,
  config: ConfigIA,
  negocioId: string,
  conversacionId: string,
  opciones: Opciones,
): Promise<ResultadoInterpretacion> {
  const inicio = Date.now();
  let algunaOk = false;
  // Un pedido que este proceso ya canceló: si la vuelta se repite (el cajero editó en el medio),
  // no se vuelve a pedir la cancelación, que ahora diría "ya estaba cancelado".
  let cancelado: PedidoDelCliente | null = null;
  if (opciones.esperarRafaga) await dormir(ESPERA_RAFAGA_MS);

  for (let vuelta = 0; vuelta < MAX_VUELTAS && Date.now() - inicio < MAX_DURACION_MS; vuelta++) {
    // Conversación: del negocio y abierta. Desde acá, service_role: todo filtra por negocio_id.
    const { data: conv, error: errConv } = await admin
      .from('conversaciones')
      .select('estado, version, borrador, pendientes, cliente_id')
      .eq('id', conversacionId)
      .eq('negocio_id', negocioId)
      .maybeSingle();
    if (errConv) return 'error';
    if (!conv || conv.estado !== 'abierta') return algunaOk ? 'ok' : 'nada';

    const { data: nuevos, error: errNuevos } = await admin
      .from('mensajes')
      .select('id, contenido')
      .eq('conversacion_id', conversacionId)
      .eq('negocio_id', negocioId)
      .eq('interpretado', false)
      .eq('tipo', 'texto')
      .order('orden')
      .limit(MAX_MENSAJES_POR_VUELTA);
    if (errNuevos) return 'error';
    if (!nuevos?.length) return algunaOk ? 'ok' : 'nada';

    // IA del local: el operador la permite, el dueño la tiene prendida, el local no está
    // suspendido. Antes del límite y de la IA: con alguna apagada no se gasta nada.
    const { data: negocio, error: errNegocio } = await admin
      .from('negocios')
      .select('nombre, activo, ia_permitida, ia_activa, config')
      .eq('id', negocioId)
      .maybeSingle();
    if (errNegocio || !negocio) return 'error';
    if (!negocio.activo || !negocio.ia_permitida || !negocio.ia_activa) return 'ia_apagada';

    if (opciones.consumirLimite) {
      const { data: dentro, error: errLimite } = await admin.rpc('consumir_limite_ia_cliente', {
        p_negocio_id: negocioId,
        p_cliente_id: conv.cliente_id,
        p_max_negocio: LIMITE_IA_NEGOCIO,
        p_max_cliente: LIMITE_IA_CLIENTE,
      });
      if (errLimite) return 'error';
      if (dentro !== true) return 'limite';
    }

    const { data: productos, error: errMenu } = await admin
      .from('productos')
      .select('id, nombre, alias, activo, precio_centavos')
      .eq('negocio_id', negocioId);
    if (errMenu || !productos) return 'error';
    const { texto: menuTexto, menu } = construirMenu(productos);

    // Contexto: los últimos ya interpretados (incluye audios, fotos y ubicaciones, que entran
    // marcados). Los nuevos van juntos como un solo mensaje.
    const { data: previos, error: errHist } = await admin
      .from('mensajes')
      .select('rol, contenido')
      .eq('conversacion_id', conversacionId)
      .eq('negocio_id', negocioId)
      .eq('interpretado', true)
      .order('orden', { ascending: false })
      .limit(5);
    if (errHist) return 'error';
    const historial = historialWhatsApp(
      ((previos ?? []) as MensajeHistorial[]).reverse(),
      nuevos.map((m) => m.contenido),
    );

    // Borrador guardado (con lo que editó el cajero), solo con productos activos de este negocio.
    const activos = new Set(menu.map((p) => p.id));
    const base: Borrador = BorradorSchema.catch(borradorVacio()).parse(conv.borrador ?? {});
    const quitados = base.items.filter((it) => !activos.has(it.producto_id)).length;
    const borradorInicial: Borrador = { ...base, items: base.items.filter((it) => activos.has(it.producto_id)) };
    const pendientesPrevios = PendientesSchema.catch(SIN_PENDIENTES).parse(conv.pendientes ?? {});

    let respuesta;
    try {
      respuesta = await llamarIA(config, construirMensajes(menuTexto, menu, borradorInicial, historial));
    } catch (e) {
      console.error('interpretar-whatsapp: falla de IA', e instanceof ErrorIA ? e.message.slice(0, 200) : 'desconocida');
      return 'error_ia';
    }

    const aplicado = aplicarAcciones(borradorInicial, respuesta.respuesta.acciones, menu);

    // Respuesta al cliente: solo en conversaciones de WhatsApp (las pegadas a mano no tienen a
    // quién contestarle). Saluda la primera vez que el bot le escribe en esta conversación.
    let respuestaCliente: string | null = null;
    // Lo que el cajero tiene que resolver por algo que pidió el cliente (cancelar algo ya en cocina).
    const avisosCajero: string[] = [];
    if (conv.cliente_id) {
      // Cancelar un pedido ya confirmado: solo si la cocina no lo empezó (lo decide la base).
      let cancelacion: Cancelacion | undefined;
      if (aplicado.cancelar === 'pedido') {
        if (cancelado) {
          cancelacion = { pedido: cancelado, cancelado: true };
        } else {
          const { data, error: errCancelar } = await admin.rpc('cancelar_pedido_cliente', {
            p_negocio_id: negocioId,
            p_cliente_id: conv.cliente_id,
          });
          if (errCancelar) return 'error';
          const r = data as (PedidoDelCliente & { cancelado: boolean }) | null;
          cancelacion = r ? { pedido: { numero: r.numero, estado: r.estado, modo: r.modo }, cancelado: r.cancelado } : null;
          if (r?.cancelado) cancelado = { numero: r.numero, estado: r.estado, modo: r.modo };
        }
        if (cancelacion && !cancelacion.cancelado && cancelacion.pedido.estado !== 'cancelado') {
          avisosCajero.push(`El cliente pide cancelar el pedido #${cancelacion.pedido.numero}, que ya está ${
            cancelacion.pedido.estado === 'entregado' ? 'entregado' : 'en cocina'
          }.`);
        }
      } else if (aplicado.cancelar === 'borrador') {
        cancelacion = 'borrador';
      }

      // Cómo va su pedido: el último de las últimas 12 horas.
      let estadoPedido: PedidoDelCliente | null | undefined;
      if (aplicado.estado) {
        const { data: ultimo, error: errUltimo } = await admin
          .from('pedidos')
          .select('numero, estado, entrega')
          .eq('negocio_id', negocioId)
          .eq('cliente_id', conv.cliente_id)
          .gt('created_at', new Date(Date.now() - 12 * 3600_000).toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (errUltimo) return 'error';
        const modo = (ultimo?.entrega as { modo?: PedidoDelCliente['modo'] } | null)?.modo ?? null;
        estadoPedido = ultimo ? { numero: ultimo.numero, estado: ultimo.estado, modo } : null;
      }

      const { count, error: errPrevias } = await admin
        .from('mensajes')
        .select('id', { count: 'exact', head: true })
        .eq('conversacion_id', conversacionId)
        .eq('negocio_id', negocioId)
        .eq('rol', 'asistente');
      if (errPrevias) return 'error';
      respuestaCliente = respuestaBot({
        negocio: negocio.nombre,
        borrador: aplicado.borrador,
        menu,
        preguntas: aplicado.preguntas,
        dudosos: aplicado.dudosos,
        errores: aplicado.errores.length,
        cambio: JSON.stringify(aplicado.borrador) !== JSON.stringify(borradorInicial),
        primera: (count ?? 0) === 0,
        consulta: aplicado.consulta,
        precios: new Map(productos.map((p) => [p.id, p.precio_centavos])),
        listo: respuesta.respuesta.listo_para_confirmar,
        estadoPedido,
        pagos: aplicado.pago ? leerPagos(negocio.config) : undefined,
        cancelacion,
      });
    }
    const { error: errGuardar } = await admin.rpc('guardar_interpretacion_wa', {
      p_negocio_id: negocioId,
      p_conversacion_id: conversacionId,
      p_version: conv.version,
      p_mensajes: nuevos.map((m) => m.id),
      p_borrador: aplicado.borrador,
      // Si el bot contestó, las preguntas ya se las hizo él al cliente: no quedan como tarea del
      // cajero ("Preguntale al cliente"). Los dudosos sí, los resuelve el cajero.
      p_pendientes: combinarPendientes(
        pendientesPrevios,
        {
          ...aplicado,
          preguntas: respuestaCliente ? [] : aplicado.preguntas,
          errores: [...aplicado.errores, ...avisosCajero],
        },
        quitados,
      ),
      p_modelo: respuesta.modelo,
      p_tokens_entrada: respuesta.tokensEntrada,
      p_tokens_salida: respuesta.tokensSalida,
      p_respuesta: respuestaCliente ?? undefined,
    });
    if (errGuardar) {
      // El cajero editó en el medio, o un producto se agotó: se vuelve a leer y a interpretar.
      if (errGuardar.code === '40001' || errGuardar.code === '23514') continue;
      if (errGuardar.code === '22023') return algunaOk ? 'ok' : 'nada'; // se cerró
      console.error('interpretar-whatsapp: no se pudo guardar', errGuardar.code);
      return 'error';
    }
    algunaOk = true;
  }
  return algunaOk ? 'ok' : 'nada';
}
