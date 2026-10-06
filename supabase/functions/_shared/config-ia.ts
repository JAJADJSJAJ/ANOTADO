import type { ConfigIA } from '@anotado/shared';

/** Lee y valida la configuración de IA. Un IA_EXTRA mal formado no rompe la función. */
export function leerConfigIA(): ConfigIA | string {
  const baseUrl = Deno.env.get('IA_BASE_URL');
  const apiKey = Deno.env.get('IA_API_KEY');
  const modelo = Deno.env.get('IA_MODELO');
  if (!baseUrl || !apiKey || !modelo) return 'faltan IA_BASE_URL, IA_API_KEY o IA_MODELO';
  // La URL la pone solo el operador (secreto del servidor), nunca la solicitud. Igual se valida:
  // https obligatorio salvo para desarrollo local.
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'IA_BASE_URL no es una URL válida';
  }
  const local = ['localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return 'IA_BASE_URL tiene que ser https';
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
