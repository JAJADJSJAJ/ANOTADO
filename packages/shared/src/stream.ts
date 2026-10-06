/**
 * Lee un stream como texto UTF-8 cortando MIENTRAS lee: si pasa `maxBytes`, cancela y
 * devuelve null sin haber cargado el resto en memoria. Se usa para lo que entra a
 * las Edge Functions y para lo que responde el proveedor de IA.
 */
export async function leerTextoAcotado(
  cuerpo: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (!cuerpo) return '';
  const lector = cuerpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await lector.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(total);
  let desde = 0;
  for (const parte of partes) {
    bytes.set(parte, desde);
    desde += parte.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Cuerpo JSON de una solicitud a una Edge Function, con tamaño máximo. Se corta MIENTRAS se
 * lee el stream (no se carga entero para medirlo después). Content-Length solo sirve para
 * rechazar antes; no se confía en él.
 */
export async function leerCuerpoJson(
  req: Request,
  maxBytes: number,
): Promise<{ cuerpo: unknown } | { status: 400 | 413 | 415 }> {
  const tipo = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (tipo !== 'application/json') return { status: 415 };
  const declarado = Number(req.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > maxBytes) return { status: 413 };
  const texto = await leerTextoAcotado(req.body, maxBytes).catch(() => '');
  if (texto === null) return { status: 413 };
  try {
    return { cuerpo: JSON.parse(texto) };
  } catch {
    return { status: 400 };
  }
}
