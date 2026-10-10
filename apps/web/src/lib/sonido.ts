/**
 * Sonidos generados con Web Audio: sin archivos que descargar.
 *
 * Hay dos clases:
 * - Alarmas de la cocina (pedido nuevo, cancelado): fuertes, para escucharse en una cocina.
 *   Los navegadores bloquean el audio hasta que alguien toca la pantalla, por eso la cocina
 *   arranca con un botón que llama a activarSonido(). Suenan siempre que estén activadas.
 * - Sonidos de la interfaz (efecto()): cortos y suaves, con forma de objeto real (el click de
 *   una birome, una impresora de tickets, un sello). Se apagan con el interruptor de la barra
 *   y la preferencia queda guardada en el navegador.
 */
let contexto: AudioContext | null = null;
let salida: GainNode | null = null;
let ruidoBuf: AudioBuffer | null = null;

function obtener(): AudioContext | null {
  try {
    if (!contexto) {
      contexto = new AudioContext();
      salida = contexto.createGain();
      salida.gain.value = 0.9;
      salida.connect(contexto.destination);
    }
    if (contexto.state === 'suspended') void contexto.resume();
    return contexto;
  } catch {
    return null;
  }
}

export async function activarSonido(): Promise<boolean> {
  const ctx = obtener();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    return false;
  }
  return ctx.state === 'running';
}

function ruido(ctx: AudioContext): AudioBuffer {
  if (ruidoBuf) return ruidoBuf;
  ruidoBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const d = ruidoBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ruidoBuf;
}

/** Ráfaga de ruido filtrado: clicks, papel, golpes. */
function rafaga(ctx: AudioContext, t: number, dur: number, frec: number, q: number, vol: number, tipo: BiquadFilterType = 'bandpass') {
  const s = ctx.createBufferSource();
  s.buffer = ruido(ctx);
  const f = ctx.createBiquadFilter();
  f.type = tipo;
  f.frequency.value = frec;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(salida!);
  s.start(t, Math.random() * 0.3);
  s.stop(t + dur + 0.01);
}

/** Tono con un ataque corto y caída exponencial; f0 → f1 hace un barrido. */
function tono(ctx: AudioContext, t: number, f0: number, f1: number, dur: number, vol: number, tipo: OscillatorType = 'sine') {
  const o = ctx.createOscillator();
  o.type = tipo;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(salida!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// ---------- alarmas de la cocina ----------

function nota(ctx: AudioContext, frecuencia: number, inicio: number, duracion: number) {
  const osc = ctx.createOscillator();
  const volumen = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frecuencia;
  volumen.gain.setValueAtTime(0.0001, inicio);
  volumen.gain.exponentialRampToValueAtTime(0.6, inicio + 0.02);
  volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  osc.connect(volumen).connect(salida!);
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

// ---------- sonidos de la interfaz ----------

const EFECTOS = {
  /** Botón: el click seco de una birome. */
  tap(ctx: AudioContext, t: number) {
    rafaga(ctx, t, 0.018, 3800, 2.5, 0.16);
    tono(ctx, t, 1900, 1400, 0.02, 0.02, 'triangle');
  },
  /** Interruptor, pestaña: dos clicks cortos. */
  llave(ctx: AudioContext, t: number) {
    rafaga(ctx, t, 0.012, 2400, 3, 0.14);
    rafaga(ctx, t + 0.045, 0.012, 3400, 3, 0.11);
  },
  /** Mensaje que sale. */
  enviar(ctx: AudioContext, t: number) {
    tono(ctx, t, 420, 880, 0.09, 0.06);
    rafaga(ctx, t, 0.03, 6000, 1, 0.025, 'highpass');
  },
  /** Mensaje que llega. */
  recibir(ctx: AudioContext, t: number) {
    tono(ctx, t, 880, 880, 0.08, 0.04, 'triangle');
    tono(ctx, t + 0.08, 1320, 1320, 0.12, 0.035, 'triangle');
  },
  /** La IA anotó algo en el pedido: un lápiz que escribe. */
  anotar(ctx: AudioContext, t: number) {
    for (let i = 0; i < 3; i++) rafaga(ctx, t + i * 0.045, 0.035, 2600 + i * 400, 4, 0.045);
  },
  /** Pedido confirmado: impresora de tickets y el corte del papel. */
  imprimir(ctx: AudioContext, t: number) {
    for (let i = 0; i < 22; i++) {
      rafaga(ctx, t + i * 0.034, 0.022, 2200 + (i % 3) * 300, 6, 0.09);
      tono(ctx, t + i * 0.034, 180, 160, 0.025, 0.02, 'square');
    }
    rafaga(ctx, t + 0.8, 0.06, 5200, 0.8, 0.12, 'highpass');
  },
  /** Sello de LISTO. */
  sello(ctx: AudioContext, t: number) {
    tono(ctx, t, 150, 60, 0.16, 0.3);
    rafaga(ctx, t, 0.07, 900, 0.7, 0.22, 'lowpass');
    rafaga(ctx, t + 0.005, 0.02, 3000, 1, 0.07);
  },
  /** Algo salió bien (guardado, copiado). */
  ok(ctx: AudioContext, t: number) {
    tono(ctx, t, 1046.5, 1046.5, 0.12, 0.035, 'triangle');
    tono(ctx, t + 0.07, 1568, 1568, 0.18, 0.03, 'triangle');
  },
  /** Error: dos golpes graves y apagados, sin alarma. */
  error(ctx: AudioContext, t: number) {
    tono(ctx, t, 220, 200, 0.09, 0.07, 'triangle');
    tono(ctx, t + 0.11, 196, 175, 0.14, 0.07, 'triangle');
  },
  /** Papel que se arruga: algo se descartó o se borró. */
  descartar(ctx: AudioContext, t: number) {
    for (let i = 0; i < 5; i++) rafaga(ctx, t + i * 0.028 + Math.random() * 0.01, 0.03, 1800 + Math.random() * 2400, 1.5, 0.06);
  },
  /** Se abre un panel o diálogo. */
  abrir(ctx: AudioContext, t: number) {
    rafaga(ctx, t, 0.08, 1400, 0.6, 0.035, 'bandpass');
    tono(ctx, t, 520, 700, 0.07, 0.02);
  },
} as const;

export type Efecto = keyof typeof EFECTOS;

// ---------- preferencia ----------

const CLAVE = 'anotado:sonido-interfaz';
let encendido = leerPreferencia();
const oyentes = new Set<() => void>();

function leerPreferencia(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== 'no';
  } catch {
    return true;
  }
}

export function sonidoInterfaz(): boolean {
  return encendido;
}

export function cambiarSonidoInterfaz(si: boolean) {
  encendido = si;
  try {
    localStorage.setItem(CLAVE, si ? 'si' : 'no');
  } catch {
    // Sin almacenamiento (modo privado): vale para esta visita.
  }
  oyentes.forEach((o) => o());
}

export function escucharSonidoInterfaz(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/** Toca un sonido de la interfaz si está prendido. No hace nada si el navegador no deja. */
export function efecto(nombre: Efecto) {
  if (!encendido) return;
  const ctx = obtener();
  if (!ctx) return;
  if (ctx.state === 'running') return EFECTOS[nombre](ctx, ctx.currentTime + 0.005);
  // Primer toque de la visita: el navegador recién destraba el audio.
  void ctx.resume().then(
    () => ctx.state === 'running' && EFECTOS[nombre](ctx, ctx.currentTime + 0.005),
    () => undefined,
  );
}

/**
 * Click en cualquier botón o link con forma de botón, escuchando una sola vez en el documento.
 * Un elemento con data-sonido="no" no suena; con data-sonido="<efecto>" suena ese.
 */
export function instalarClicks() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>('button, a.btn, [role="tab"], [data-sonido]');
      if (!el || el.matches(':disabled, [aria-disabled="true"]')) return;
      const pedido = el.dataset.sonido;
      if (pedido === 'no') return;
      efecto(pedido && pedido in EFECTOS ? (pedido as Efecto) : 'tap');
    },
    { capture: true, passive: true },
  );
}
