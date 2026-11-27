import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Escena de la pantalla de entrada: un celular donde se tipea un pedido de WhatsApp, el mensaje
// viaja como tinta de birome y se imprime en una comanda que termina marcada como lista.
// Todo se arma con geometrías y CanvasTexture (nada remoto, por la CSP).

const COLOR = {
  tinta: '#151513',
  tinta2: '#57564f',
  tinta3: '#8b8a82',
  linea: '#cfccc2',
  ticket: '#fffefa',
  birome: '#1f3fe0',
  ok: '#17804a',
  okSuave: '#e3f3e9',
  alertaTinta: '#7a5300',
  wa: '#0f5a4f',
  waFondo: '#ece6dc',
  waPropio: '#d9f6c4',
};
const SANS = "'Bricolage Grotesque Variable', ui-sans-serif, system-ui, sans-serif";
const MONO = "'JetBrains Mono Variable', ui-monospace, Consolas, monospace";
const MENSAJE = 'Hola! Quiero 2 completas sin tomate y una coca de 1,5';

/** Duración del loop y momentos de la historia, en segundos. */
const CICLO = 12;
const T = {
  tipeo: [0.8, 3.3],
  envio: 3.55,
  viaje: 3.75,
  leido: 4.9,
  imprime: [4.7, 7.0],
  sello: [7.4, 7.8],
  sale: [11.0, 12],
  final: 10,
} as const;

/** Área que tiene que entrar en cuadro (unidades de escena). */
const ANCHO = 5.1;
const ALTO = 3.9;

// Comanda: medidas y textura.
const TK_W = 1.7;
const TK_H = 2.6;
const TK_SX = 16;
const TK_SY = 48;
const TK_PX = 512;
const TK_PY = Math.round((TK_PX * TK_H) / TK_W);
const PX_POR_U = TK_PX / TK_W;

const fase = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const salida = (p: number) => 1 - Math.pow(1 - p, 3);
const suave = (p: number) => p * p * (3 - 2 * p);
const rebote = (p: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};

export interface OpcionesEscena {
  /** Sin animación: se dibuja el estado final y listo (reduced-motion). */
  estatica: boolean;
  /** Versión chica para móvil: menos partículas y menos resolución. */
  compacta: boolean;
  /** Se llama cuando el primer cuadro ya está dibujado (para el fundido de entrada). */
  alListo?: () => void;
}

export function hayWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

function lienzo(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Sin canvas 2D');
  return { c, ctx };
}

function textura(c: HTMLCanvasElement, aniso: number) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function rectRedondo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Corta un texto en renglones que entren en `max` px. */
function renglones(ctx: CanvasRenderingContext2D, texto: string, max: number): string[] {
  const salidaR: string[] = [];
  let actual = '';
  for (const palabra of texto.split(' ')) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (ctx.measureText(prueba).width > max && actual) {
      salidaR.push(actual);
      actual = palabra;
    } else actual = prueba;
  }
  if (actual) salidaR.push(actual);
  return salidaR;
}

// ---------------------------------------------------------------- pantalla del celular

const CEL_PX = 512;
const CEL_PY = 1056;

function dibujarCelular(ctx: CanvasRenderingContext2D, letras: number, enviado: boolean, leido: boolean, cursor: boolean) {
  const W = CEL_PX;
  ctx.clearRect(0, 0, W, CEL_PY);
  ctx.save();
  // Esquinas de pantalla de iPhone: el resto queda transparente.
  rectRedondo(ctx, 0, 0, W, CEL_PY, 66);
  ctx.clip();
  ctx.fillStyle = COLOR.waFondo;
  ctx.fillRect(0, 0, W, CEL_PY);

  // Trama sutil del fondo de chat.
  ctx.fillStyle = 'rgba(21,21,19,0.035)';
  for (let y = 190; y < 940; y += 46) for (let x = (y / 46) % 2 ? 20 : 43; x < W; x += 46) ctx.fillRect(x, y, 4, 4);

  // Encabezado.
  ctx.fillStyle = COLOR.wa;
  ctx.fillRect(0, 0, W, 158);
  ctx.fillStyle = '#0b0b0a';
  rectRedondo(ctx, W / 2 - 74, 18, 148, 42, 21);
  ctx.fill();
  ctx.fillStyle = COLOR.waPropio;
  ctx.beginPath();
  ctx.arc(70, 106, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOR.wa;
  ctx.font = `700 28px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LT', 70, 107);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText('Lo de Tito', 118, 94);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `400 23px ${SANS}`;
  ctx.fillText(letras > 0 && !enviado ? 'escribiendo…' : 'en línea', 118, 128);

  // Mensaje del local.
  ctx.font = `500 30px ${SANS}`;
  ctx.fillStyle = '#fff';
  rectRedondo(ctx, 24, 200, 330, 70, [6, 18, 18, 18]);
  ctx.fill();
  ctx.fillStyle = COLOR.tinta;
  ctx.fillText('¡Hola! ¿Qué te mando?', 44, 236);

  // Burbuja propia, ya enviada.
  if (enviado) {
    ctx.font = `500 31px ${SANS}`;
    const lineas = renglones(ctx, MENSAJE, 330);
    const alto = lineas.length * 41 + 66;
    const x = W - 24 - 370;
    const y = 300;
    ctx.fillStyle = COLOR.waPropio;
    rectRedondo(ctx, x, y, 370, alto, [18, 6, 18, 18]);
    ctx.fill();
    ctx.fillStyle = COLOR.tinta;
    lineas.forEach((l, i) => ctx.fillText(l, x + 20, y + 36 + i * 41));
    ctx.font = `500 21px ${MONO}`;
    ctx.fillStyle = '#6f7a70';
    ctx.fillText('21:04', x + 370 - 128, y + alto - 22);
    // Doble tilde: gris al enviar, azul birome cuando el local lo leyó.
    ctx.strokeStyle = leido ? COLOR.birome : '#8b958c';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const dx of [0, 10]) {
      const bx = x + 370 - 52 + dx;
      const by = y + alto - 22;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + 6, by + 6);
      ctx.lineTo(bx + 18, by - 7);
      ctx.stroke();
    }
  }

  // Barra para escribir.
  ctx.fillStyle = '#fff';
  rectRedondo(ctx, 18, 952, 398, 70, 35);
  ctx.fill();
  ctx.font = `500 28px ${SANS}`;
  const escrito = enviado ? '' : MENSAJE.slice(0, letras);
  let visible = escrito;
  while (visible && ctx.measureText(visible).width > 350) visible = visible.slice(1);
  if (visible) {
    ctx.fillStyle = COLOR.tinta;
    ctx.fillText(visible, 40, 988);
  } else {
    ctx.fillStyle = COLOR.tinta3;
    ctx.fillText('Mensaje', 40, 988);
  }
  if (cursor && !enviado) {
    const cx = 40 + (visible ? ctx.measureText(visible).width + 3 : 0);
    ctx.fillStyle = COLOR.wa;
    ctx.fillRect(cx, 970, 3, 36);
  }
  ctx.fillStyle = COLOR.wa;
  ctx.beginPath();
  ctx.arc(462, 987, 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(448, 970);
  ctx.lineTo(480, 987);
  ctx.lineTo(448, 1004);
  ctx.lineTo(453, 987);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- comanda

function dibujarComanda(ctx: CanvasRenderingContext2D) {
  const W = TK_PX;
  const H = TK_PY;
  const diente = 12;
  const paso = 22;
  const m = 34;
  ctx.clearRect(0, 0, W, H);

  // Papel liso con el borde de abajo dentado (lo transparente se descarta con alphaTest).
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H - diente);
  for (let x = W; x > 0; x -= paso) {
    ctx.lineTo(x - paso / 2, H - 1);
    ctx.lineTo(x - paso, H - diente);
  }
  ctx.closePath();
  ctx.fillStyle = COLOR.ticket;
  ctx.fill();

  ctx.textBaseline = 'alphabetic';

  // Cabecera: número y, abajo, los datos en mono. El chip de LISTO va aparte (arriba a la derecha).
  ctx.fillStyle = COLOR.tinta3;
  ctx.font = `600 22px ${MONO}`;
  ctx.fillText('PEDIDO', m, 66);
  ctx.fillStyle = COLOR.tinta;
  ctx.font = `800 112px ${SANS}`;
  ctx.fillText('42', m - 4, 172);

  const linea = (y: number) => {
    ctx.fillStyle = COLOR.linea;
    ctx.fillRect(m, y, W - m * 2, 2);
  };
  linea(206);

  // Dos módulos de datos lado a lado.
  const dato = (x: number, rotulo: string, valor: string) => {
    ctx.fillStyle = COLOR.tinta3;
    ctx.font = `600 19px ${MONO}`;
    ctx.fillText(rotulo, x, 246);
    ctx.fillStyle = COLOR.tinta;
    ctx.font = `700 30px ${SANS}`;
    ctx.fillText(valor, x, 284);
  };
  dato(m, 'ENTREGA', 'Retira');
  dato(W / 2 + 6, 'CANAL', 'WhatsApp');
  linea(314);

  // Ítems: cantidad en una cajita, nombre y nota.
  const item = (cant: string, nombre: string, y: number, nota?: string) => {
    ctx.fillStyle = '#efede6';
    rectRedondo(ctx, m, y - 40, 52, 52, 12);
    ctx.fill();
    ctx.fillStyle = COLOR.tinta;
    ctx.font = `800 32px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(cant, m + 26, y - 2);
    ctx.textAlign = 'left';
    ctx.font = `700 38px ${SANS}`;
    ctx.fillText(nombre, m + 72, y - 2);
    if (nota) {
      ctx.fillStyle = COLOR.tinta2;
      ctx.font = `500 26px ${SANS}`;
      ctx.fillText(nota, m + 72, y + 36);
    }
  };
  item('2', 'Completa', 388, 'sin tomate');
  item('1', 'Coca-Cola 1,5 L', 500);

  linea(560);
  ctx.font = `500 20px ${MONO}`;
  ctx.fillStyle = COLOR.tinta3;
  ctx.fillText('21:04', m, 600);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLOR.birome;
  ctx.fillText('anotado por IA', W - m, 600);
  ctx.textAlign = 'left';
}

/** Chip de estado: una pastilla tinta con un tilde birome y "Listo". */
function dibujarSello(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLOR.tinta;
  rectRedondo(ctx, 0, 0, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = '#8fa2ff';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(h * 0.36, h * 0.52);
  ctx.lineTo(h * 0.5, h * 0.66);
  ctx.lineTo(h * 0.74, h * 0.36);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(h * 0.42)}px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Listo', h * 0.92, h * 0.53);
}

function dibujarSombra(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Dos sombras blandas sobre la mesa, sin charco de luz.
  for (const [cx, rx] of [
    [w * 0.24, w * 0.15],
    [w * 0.74, w * 0.16],
  ] as const) {
    ctx.save();
    ctx.translate(cx, h / 2);
    ctx.scale(1, 0.32);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Curvatura y ondulación del papel en (x, y) local. */
function superficie(x: number, y: number, t: number) {
  const borde = Math.max(0, (-y / (TK_H / 2) + 0.2) / 1.2);
  return (
    0.11 * (x / (TK_W / 2)) ** 2 +
    0.022 * Math.sin(x * 2.2 + y * 0.9 + t * 1.1) +
    0.045 * borde * borde * Math.sin(t * 2.1 + x * 3.1)
  );
}

// ---------------------------------------------------------------- montaje

/** Monta la escena dentro de `host` y devuelve la función que la desarma por completo. */
export function montarEscena(host: HTMLElement, op: OpcionesEscena): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  try {
    return armarEscena(renderer, host, op);
  } catch (e) {
    // Si algo falla a mitad de camino, no dejar un contexto WebGL colgado ni un canvas suelto.
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    throw e;
  }
}

function armarEscena(renderer: THREE.WebGLRenderer, host: HTMLElement, op: OpcionesEscena): () => void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, op.compacta ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const escena = new THREE.Scene();
  escena.fog = new THREE.Fog(COLOR.tinta, 9, 17);
  const camara = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const mirar = new THREE.Vector3(0, -0.05, 0);

  escena.add(new THREE.HemisphereLight(0xfffdf5, 0x2a2822, 1.7));
  const sol = new THREE.DirectionalLight(0xffffff, 2.1);
  sol.position.set(2.5, 4, 5);
  escena.add(sol);
  const contraluz = new THREE.DirectionalLight(COLOR.birome, 1.4);
  contraluz.position.set(-4, 2, -3);
  escena.add(contraluz);

  // Todo lo que se inclina con el mouse cuelga de acá.
  const raiz = new THREE.Group();
  escena.add(raiz);

  const texturas: THREE.Texture[] = [];

  // Mesa: luz y sombras pintadas.
  const sombraCv = lienzo(512, 256);
  const sombraTx = textura(sombraCv.c, aniso);
  texturas.push(sombraTx);
  const mesa = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 3.2),
    new THREE.MeshBasicMaterial({ map: sombraTx, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesa.rotation.x = -Math.PI / 2;
  mesa.position.set(0, -1.75, 0);
  raiz.add(mesa);

  // Celular.
  const celular = new THREE.Group();
  celular.position.set(-1.38, 0, 0);
  celular.rotation.set(0.04, 0.38, -0.03);
  raiz.add(celular);
  // Cuerpo de iPhone: rectángulo con esquinas bien redondas, cantos biselados y marco de titanio.
  const forma = (w: number, h: number, r: number) => {
    const f = new THREE.Shape();
    f.moveTo(-w / 2 + r, -h / 2);
    f.lineTo(w / 2 - r, -h / 2);
    f.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    f.lineTo(w / 2, h / 2 - r);
    f.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    f.lineTo(-w / 2 + r, h / 2);
    f.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    f.lineTo(-w / 2, -h / 2 + r);
    f.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return f;
  };
  const marcoGeo = new THREE.ExtrudeGeometry(forma(1.44, 2.96, 0.24), {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 6,
    curveSegments: 24,
  });
  marcoGeo.translate(0, 0, -0.05);
  const marco = new THREE.Mesh(
    marcoGeo,
    new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.32, metalness: 0.85 }),
  );
  celular.add(marco);
  // Vidrio negro del frente: el borde fino alrededor de la pantalla.
  const frente = new THREE.Mesh(
    new THREE.ShapeGeometry(forma(1.44, 2.96, 0.23), 24),
    new THREE.MeshStandardMaterial({ color: 0x0b0b0a, roughness: 0.15, metalness: 0.2 }),
  );
  frente.position.z = 0.081;
  celular.add(frente);
  // Botones laterales.
  const metal = marco.material;
  for (const [x, y, alto] of [
    [-0.755, 0.78, 0.14],
    [-0.755, 0.5, 0.26],
    [-0.755, 0.18, 0.26],
    [0.755, 0.45, 0.4],
  ] as const) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.03, alto, 0.06, 2, 0.012), metal);
    b.position.set(x, y, 0);
    celular.add(b);
  }
  const pantallaCv = lienzo(CEL_PX, CEL_PY);
  const pantallaTx = textura(pantallaCv.c, aniso);
  texturas.push(pantallaTx);
  const pantallaMat = new THREE.MeshBasicMaterial({ map: pantallaTx, toneMapped: false, transparent: true });
  const pantalla = new THREE.Mesh(new THREE.PlaneGeometry(1.36, (1.36 * CEL_PY) / CEL_PX), pantallaMat);
  pantalla.position.z = 0.083;
  celular.add(pantalla);
  // Comanda.
  const comanda = new THREE.Group();
  comanda.position.set(1.28, 0.06, 0.1);
  raiz.add(comanda);
  const papelCv = lienzo(TK_PX, TK_PY);
  const papelTx = textura(papelCv.c, aniso);
  texturas.push(papelTx);
  const papelGeo = new THREE.PlaneGeometry(TK_W, TK_H, TK_SX, TK_SY);
  const base = Float32Array.from(papelGeo.attributes.position!.array as ArrayLike<number>);
  const papelMat = new THREE.MeshStandardMaterial({
    map: papelTx,
    roughness: 0.92,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
    transparent: true,
  });
  const papel = new THREE.Mesh(papelGeo, papelMat);
  comanda.add(papel);
  const indicesFila = TK_SX * 6;

  const aLocal = (px: number, py: number) => new THREE.Vector3(px / PX_POR_U - TK_W / 2, TK_H / 2 - py / PX_POR_U, 0);

  // Chip "Listo", arriba a la derecha, sin pisar el número.
  const selloCv = lienzo(320, 96);
  const selloTx = textura(selloCv.c, aniso);
  texturas.push(selloTx);
  const selloMat = new THREE.MeshBasicMaterial({ map: selloTx, transparent: true, depthWrite: false, toneMapped: false });
  const selloAncho = 190 / PX_POR_U;
  const sello = new THREE.Mesh(new THREE.PlaneGeometry(selloAncho, selloAncho * (96 / 320)), selloMat);
  const selloXY = aLocal(TK_PX - 34 - 95, 58);
  comanda.add(sello);

  // Trazo de birome que viaja del celular a la comanda: una línea fina, sin brillo.
  const curva = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-0.75, 0.55, 0.3),
    new THREE.Vector3(-0.35, 1.5, 0.8),
    new THREE.Vector3(0.35, 1.45, 0.7),
    new THREE.Vector3(0.62, 0.95, 0.25),
  );
  const trazoSeg = 120;
  const trazoRad = 6;
  const trazoGeo = new THREE.TubeGeometry(curva, trazoSeg, 0.012, trazoRad, false);
  const trazoMat = new THREE.MeshBasicMaterial({ color: COLOR.birome, transparent: true });
  const trazo = new THREE.Mesh(trazoGeo, trazoMat);
  raiz.add(trazo);
  const trazoBloque = trazoRad * 6;
  const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), trazoMat);
  raiz.add(cabeza);
  const punto = new THREE.Vector3();

  // ------------------------------------------------------------ estado por cuadro

  let claveCelular = '';
  let textosListos = false;
  function actualizarCelular(t: number) {
    if (!textosListos) return;
    const letras = Math.floor(fase(t, T.tipeo[0], T.tipeo[1]) * MENSAJE.length);
    const enviado = t >= T.envio;
    const leido = t >= T.leido;
    const cursor = !op.estatica && Math.floor(t * 2.4) % 2 === 0;
    const clave = `${letras}|${enviado}|${leido}|${cursor}`;
    if (clave === claveCelular) return;
    claveCelular = clave;
    dibujarCelular(pantallaCv.ctx, letras, enviado, leido, cursor);
    pantallaTx.needsUpdate = true;
  }

  function ondular(t: number) {
    const pos = papelGeo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) arr[i + 2] = superficie(base[i]!, base[i + 1]!, t);
    pos.needsUpdate = true;
    papelGeo.computeVertexNormals();
  }

  function cuadro(t: number, reloj: number) {
    actualizarCelular(t);

    // El celular respira y la pantalla se apaga y prende entre vueltas.
    celular.position.y = Math.sin(reloj * 0.8) * 0.05;
    celular.rotation.y = 0.38 + Math.sin(reloj * 0.45) * 0.05;
    const brillo = Math.min(fase(t, 0, 0.6), 1 - fase(t, T.sale[0] + 0.3, T.sale[1])) * 0.85 + 0.15;
    pantallaMat.color.setScalar(brillo);

    // Trazo: la punta avanza y la cola la sigue.
    const pv = fase(t, T.viaje, T.viaje + 1.3);
    const punta = salida(Math.min(1, pv * 1.25));
    const cola = suave(Math.max(0, pv * 1.25 - 0.25));
    trazo.visible = pv > 0 && pv < 1;
    cabeza.visible = trazo.visible;
    const desde = Math.floor(cola * trazoSeg) * trazoBloque;
    const hasta = Math.ceil(punta * trazoSeg) * trazoBloque;
    trazoGeo.setDrawRange(desde, Math.max(0, hasta - desde));
    curva.getPoint(punta, punto);
    cabeza.position.copy(punto);

    // Comanda: se imprime de arriba hacia abajo, flota y gira suave.
    const imp = fase(t, T.imprime[0], T.imprime[1]);
    const fuera = fase(t, T.sale[0], T.sale[1]);
    comanda.visible = imp > 0 && fuera < 1;
    const filas = Math.ceil(imp * TK_SY);
    papelGeo.setDrawRange(0, filas * indicesFila);
    const opacidad = Math.min(1, imp * 6) * (1 - suave(fuera));
    papelMat.opacity = opacidad;
    papelMat.alphaTest = opacidad < 0.99 ? 0.5 * opacidad : 0.5;
    const golpe = fase(t, T.sello[1], T.sello[1] + 0.35);
    const hundido = golpe > 0 && golpe < 1 ? Math.sin(golpe * Math.PI) * 0.035 : 0;
    comanda.position.y = 0.06 + (1 - salida(imp)) * 0.55 + Math.sin(reloj * 0.7 + 1) * 0.06 + suave(fuera) * 0.4 - hundido;
    comanda.position.x = 1.28 + suave(fuera) * 0.25;
    comanda.rotation.y = -0.3 + Math.sin(reloj * 0.42) * 0.13;
    comanda.rotation.x = -0.04 + Math.sin(reloj * 0.55) * 0.03 + hundido;
    comanda.rotation.z = 0.02 + Math.sin(reloj * 0.33) * 0.015;
    ondular(reloj);

    // Chip Listo: aparece con un pop chico en su lugar.
    const ps = fase(t, T.sello[0], T.sello[1]);
    sello.visible = ps > 0;
    sello.scale.setScalar(0.6 + 0.4 * rebote(ps));
    // El papel está curvado: el chip se apoya sobre el punto más alto debajo de él, así no lo atraviesa.
    const sx = selloAncho / 2;
    const sy = (selloAncho * 0.3) / 2;
    let alto = -Infinity;
    for (const dx of [-sx, 0, sx]) for (const dy of [-sy, sy]) alto = Math.max(alto, superficie(selloXY.x + dx, selloXY.y + dy, reloj));
    sello.position.set(selloXY.x, selloXY.y, alto + 0.025);
    selloMat.opacity = Math.min(1, ps * 3) * (1 - suave(fuera));
  }

  // ------------------------------------------------------------ tamaño y cámara

  function encuadrar() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
    const distancia = Math.max(ALTO / 2 / tan, ANCHO / 2 / (tan * camara.aspect));
    camara.position.set(0, 0.35, distancia + 0.6);
    camara.lookAt(mirar);
    camara.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ bucle

  let reloj = 0;
  let previo = 0;
  let raf = 0;
  let visible = true;
  let destruido = false;
  let avisado = false;
  const puntero = { x: 0, y: 0 };

  function dibujar() {
    renderer.render(escena, camara);
    if (!avisado) {
      avisado = true;
      op.alListo?.();
    }
  }

  function paso(ahora: number) {
    raf = 0;
    if (destruido) return;
    const dt = previo ? Math.min(0.1, (ahora - previo) / 1000) : 0;
    previo = ahora;
    reloj += dt;
    const k = 1 - Math.exp(-dt * 3);
    raiz.rotation.y += (puntero.x * 0.14 - raiz.rotation.y) * k;
    raiz.rotation.x += (puntero.y * 0.07 - raiz.rotation.x) * k;
    cuadro(reloj % CICLO, reloj);
    dibujar();
    pedir();
  }

  function pedir() {
    if (op.estatica || destruido || raf || !visible || document.hidden || !textosListos) return;
    raf = requestAnimationFrame(paso);
  }

  function pausar() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    previo = 0;
  }

  function quieto() {
    cuadro(T.final, 2.2);
    dibujar();
  }

  const alMover = (e: PointerEvent) => {
    puntero.x = (e.clientX / window.innerWidth) * 2 - 1;
    puntero.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const alVisibilidad = () => (document.hidden ? pausar() : pedir());
  const observador = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible) pedir();
    else pausar();
  });
  const medidor = new ResizeObserver(() => {
    encuadrar();
    if (op.estatica && textosListos) quieto();
  });

  encuadrar();
  medidor.observe(host);
  if (!op.estatica) {
    observador.observe(host);
    document.addEventListener('visibilitychange', alVisibilidad);
    window.addEventListener('pointermove', alMover, { passive: true });
  }

  // Los canvas de texto esperan a las fuentes de la app (con tope, por si alguna no llega).
  const fuentes = document.fonts
    ? Promise.all([
        document.fonts.load(`700 40px ${SANS}`),
        document.fonts.load(`800 40px ${MONO}`),
      ]).then(() => document.fonts.ready)
    : Promise.resolve();
  void Promise.race([fuentes, new Promise((r) => setTimeout(r, 1800))])
    .catch(() => undefined)
    .then(() => {
      if (destruido) return;
      dibujarComanda(papelCv.ctx);
      papelTx.needsUpdate = true;
      dibujarSello(selloCv.ctx, 320, 96);
      selloTx.needsUpdate = true;
      dibujarSombra(sombraCv.ctx, 512, 256);
      sombraTx.needsUpdate = true;
      textosListos = true;
      if (op.estatica) quieto();
      else pedir();
    });

  return () => {
    destruido = true;
    pausar();
    medidor.disconnect();
    observador.disconnect();
    document.removeEventListener('visibilitychange', alVisibilidad);
    window.removeEventListener('pointermove', alMover);
    escena.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose();
    });
    for (const t of texturas) t.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
