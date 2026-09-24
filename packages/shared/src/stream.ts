/**
 * Lee un stream como texto UTF-8 cortando MIENTRAS lee: si pasa `maxBytes`, cancela y
 * devuelve null sin haber cargado el resto en memoria. Se usa para lo que entra a
 * parse-order y para lo que responde el proveedor de IA.
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
