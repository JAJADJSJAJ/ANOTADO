import { describe, expect, it } from 'vitest';
import { leerTextoAcotado } from '../src/index.ts';

/** Stream que entrega `partes` trozos de `tamaño` bytes y cuenta cuántos se leyeron. */
function streamDe(partes: number, tamaño: number) {
  const leidos = { cuenta: 0 };
  let enviados = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (enviados === partes) return ctrl.close();
      enviados++;
      leidos.cuenta++;
      ctrl.enqueue(new TextEncoder().encode('x'.repeat(tamaño)));
    },
  });
  return { stream, leidos };
}

describe('leerTextoAcotado', () => {
  it('devuelve el texto si entra en el límite', async () => {
    const { stream } = streamDe(3, 10);
    expect(await leerTextoAcotado(stream, 30)).toBe('x'.repeat(30));
  });

  it('corta al pasar el límite, sin leer el resto del stream', async () => {
    const { stream, leidos } = streamDe(1000, 1024); // ~1 MB disponible
    expect(await leerTextoAcotado(stream, 4096)).toBeNull();
    expect(leidos.cuenta).toBeLessThan(10);
  });

  it('decodifica UTF-8 partido entre trozos', async () => {
    const bytes = new TextEncoder().encode('ñandú');
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(bytes.slice(0, 1)); // la ñ queda partida en dos trozos
        ctrl.enqueue(bytes.slice(1));
        ctrl.close();
      },
    });
    expect(await leerTextoAcotado(stream, 100)).toBe('ñandú');
  });

  it('cuerpo nulo es texto vacío', async () => {
    expect(await leerTextoAcotado(null, 10)).toBe('');
  });
});
