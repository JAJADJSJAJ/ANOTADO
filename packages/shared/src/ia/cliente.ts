import { z } from 'zod';
import { type RespuestaIA, RespuestaIASchema } from '../acciones.ts';
import { leerTextoAcotado } from '../stream.ts';

// Cliente para cualquier API compatible con OpenAI (OpenRouter, NVIDIA, Groq, DeepSeek…).
// Cambiar de proveedor o modelo es cambiar la configuración, no el código.
// Usa solo fetch: corre igual en Deno (Edge Functions), Node (evals) y tests.

export type ConfigIA = {
  /** Ej.: https://openrouter.ai/api/v1 */
  baseUrl: string;
  apiKey: string;
  /** Ej.: deepseek/deepseek-v4.1-flash */
  modelo: string;
  /**
   * json_schema: salida estructurada estricta (preferida).
   * json_object: solo "devolvé JSON" (para proveedores sin json_schema); igual se valida con Zod.
   */
  formato?: 'json_schema' | 'json_object';
  timeoutMs?: number;
  /** Headers extra que pide el proveedor (OpenRouter acepta HTTP-Referer y X-Title). */
  headers?: Record<string, string>;
  /**
   * Campos extra del cuerpo, propios del proveedor. Ej. en OpenRouter:
   * {"reasoning":{"enabled":false}} para que el modelo no "piense" (más rápido y barato).
   */
  cuerpoExtra?: Record<string, unknown>;
};

export type ResultadoIA = {
  respuesta: RespuestaIA;
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
};

export class ErrorIA extends Error {
  /** true si vale la pena reintentar (timeout, 429, 5xx, JSON inválido). */
  readonly reintentable: boolean;

  constructor(message: string, reintentable: boolean) {
    super(message);
    this.name = 'ErrorIA';
    this.reintentable = reintentable;
  }
}

type Mensaje = { role: 'system' | 'user'; content: string };

// Con max_tokens 1500 una respuesta legítima ocupa unos pocos KB.
const MAX_RESPUESTA_BYTES = 200_000;

/** JSON Schema de la respuesta, limpio para el modo estricto de los proveedores. */
export const ESQUEMA_RESPUESTA = limpiarEsquema(z.toJSONSchema(RespuestaIASchema));

/**
 * Llama al modelo y devuelve la respuesta validada con Zod. Timeout de 15 s y un solo
 * reintento ante errores transitorios. Si la respuesta no valida, tira ErrorIA: quien
 * llama no debe tocar el borrador.
 */
export async function llamarIA(config: ConfigIA, mensajes: Mensaje[]): Promise<ResultadoIA> {
  try {
    return await intentar(config, mensajes);
  } catch (e) {
    if (e instanceof ErrorIA && e.reintentable) return await intentar(config, mensajes);
    throw e;
  }
}

async function intentar(config: ConfigIA, mensajes: Mensaje[]): Promise<ResultadoIA> {
  const formato = config.formato ?? 'json_schema';
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...config.headers,
      },
      body: JSON.stringify({
        ...config.cuerpoExtra,
        model: config.modelo,
        messages: mensajes,
        temperature: 0,
        max_tokens: 1500,
        response_format:
          formato === 'json_schema'
            ? { type: 'json_schema', json_schema: { name: 'acciones', strict: true, schema: ESQUEMA_RESPUESTA } }
            : { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 15_000),
    });
  } catch (e) {
    throw new ErrorIA(`No se pudo contactar a la IA: ${(e as Error).message}`, true);
  }

  if (!res.ok) {
    // Solo el código: el cuerpo del error del proveedor podría repetir parte del prompt
    // (datos del cliente), y este mensaje se loguea.
    await res.body?.cancel().catch(() => {});
    throw new ErrorIA(`La IA respondió ${res.status}`, res.status === 429 || res.status >= 500);
  }

  // El timeout también corre mientras llega el cuerpo: si corta acá, es reintentable igual
  // que si hubiera cortado antes de las cabeceras. El tope se aplica durante la lectura
  // (un proveedor que ignore max_tokens no llena la memoria).
  let texto: string | null;
  try {
    texto = await leerTextoAcotado(res.body, MAX_RESPUESTA_BYTES);
  } catch (e) {
    throw new ErrorIA(`Se cortó la respuesta de la IA: ${(e as Error).name}`, true);
  }
  if (texto === null) throw new ErrorIA('La respuesta de la IA es demasiado grande', false);
  let datos: {
    model?: string;
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new ErrorIA('La IA devolvió una respuesta que no es JSON', true);
  }
  const contenido = datos.choices?.[0]?.message?.content;
  if (!contenido) throw new ErrorIA('La IA devolvió una respuesta vacía', true);

  let json: unknown;
  try {
    json = JSON.parse(extraerJson(contenido));
  } catch {
    throw new ErrorIA('La IA no devolvió JSON válido', true);
  }
  const validado = RespuestaIASchema.safeParse(json);
  if (!validado.success) {
    const problema = validado.error.issues[0];
    throw new ErrorIA(`La respuesta de la IA no tiene el formato esperado: ${problema?.path.join(".")} ${problema?.message}`, true);
  }

  return {
    respuesta: validado.data,
    modelo: datos.model ?? config.modelo,
    tokensEntrada: datos.usage?.prompt_tokens ?? 0,
    tokensSalida: datos.usage?.completion_tokens ?? 0,
  };
}

/** Algunos modelos envuelven el JSON en ```json … ``` aunque se les pida que no. */
function extraerJson(texto: string): string {
  const bloque = /```(?:json)?\s*([\s\S]*?)```/.exec(texto);
  return (bloque?.[1] ?? texto).trim();
}

/**
 * Deja el JSON Schema en el subconjunto que aceptan los modos estrictos:
 * oneOf → anyOf, y sin $schema, default, minimum/maximum ni maxItems (los límites los valida Zod
 * y el reducer después).
 */
function limpiarEsquema(nodo: unknown): Record<string, unknown> {
  const quitar = new Set(['$schema', 'minimum', 'maximum', 'maxItems', 'minItems', 'default']);
  const recorrer = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(recorrer);
    if (n && typeof n === 'object') {
      return Object.fromEntries(
        Object.entries(n)
          .filter(([k]) => !quitar.has(k))
          .map(([k, v]) => [k === 'oneOf' ? 'anyOf' : k, recorrer(v)]),
      );
    }
    return n;
  };
  return recorrer(nodo) as Record<string, unknown>;
}
