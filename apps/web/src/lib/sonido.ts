/**
 * Sonido de "pedido nuevo" generado con Web Audio: sin archivos que descargar.
 * Los navegadores bloquean el audio hasta que alguien toca la pantalla, por eso la cocina
 * arranca con un botón que llama a activarSonido().
 */
let contexto: AudioContext | null = null;

export async function activarSonido(): Promise<boolean> {
  try {
    contexto ??= new AudioContext();
    if (contexto.state === 'suspended') await contexto.resume();
    return contexto.state === 'running';
  } catch {
    return false;
  }
}

function nota(ctx: AudioContext, frecuencia: number, inicio: number, duracion: number) {
  const osc = ctx.createOscillator();
  const volumen = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frecuencia;
  volumen.gain.setValueAtTime(0.0001, inicio);
  volumen.gain.exponentialRampToValueAtTime(0.6, inicio + 0.02);
  volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  osc.connect(volumen).connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + duracion);
}

/** "Ding-dong" dos veces: se escucha por encima del ruido de una cocina. */
export function sonarPedidoNuevo() {
  const ctx = contexto;
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.05;
  for (const desfase of [0, 0.7]) {
    nota(ctx, 880, t + desfase, 0.3);
    nota(ctx, 1318.5, t + desfase + 0.22, 0.45);
  }
}

/** Dos notas que bajan: distinto del pedido nuevo, para que se note que es otra cosa. */
export function sonarCancelado() {
  const ctx = contexto;
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.05;
  nota(ctx, 659.3, t, 0.35);
  nota(ctx, 392, t + 0.3, 0.6);
}
