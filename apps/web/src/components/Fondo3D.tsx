import { useEffect, useRef } from 'react';

/**
 * Fondo del local: un shader WebGL de "cromo líquido" en grises muy suaves, detrás de todo.
 * La luz sigue al mouse (con lerp). Sin Three.js: un solo triángulo y un fragment shader.
 * Se dibuja a media resolución, se pausa con la pestaña oculta y queda quieto (un cuadro)
 * con menos movimiento. Si no hay WebGL, queda el color de papel de siempre.
 */
const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 res;
uniform float t;
uniform vec2 mouse;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
float altura(vec2 p) {
  // Dominio deformado dos veces: pliegues lentos como metal líquido.
  vec2 q = vec2(fbm(p + t * 0.04), fbm(p + vec2(5.2, 1.3) - t * 0.03));
  return fbm(p + 1.8 * q);
}
void main() {
  vec2 uv = gl_FragCoord.xy / res.y;
  vec2 p = uv * 1.6;
  float e = 0.01;
  float h = altura(p);
  vec3 n = normalize(vec3(altura(p + vec2(e, 0.0)) - h, altura(p + vec2(0.0, e)) - h, 0.06));
  vec3 luz = normalize(vec3(mouse * 1.2, 1.0));
  float dif = clamp(dot(n, luz), 0.0, 1.0);
  float esp = pow(clamp(dot(reflect(-luz, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0);
  // Papel (#efefef) con relieve gris y brillo apenas marcado.
  vec3 papel = vec3(0.937);
  vec3 c = papel - (1.0 - dif) * 0.14 + esp * 0.06;
  // Viñeta suave hacia los bordes.
  vec2 v = gl_FragCoord.xy / res - 0.5;
  c -= dot(v, v) * 0.06;
  gl_FragColor = vec4(c, 1.0);
}`;

export function Fondo3D() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!canvas || !gl) return;
    const quieto = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const conMouse = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

    const shader = (tipo: number, src: string) => {
      const s = gl.createShader(tipo)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'res');
    const uT = gl.getUniformLocation(prog, 't');
    const uMouse = gl.getUniformLocation(prog, 'mouse');

    // Media resolución: es un fondo borroso, no hace falta más (y cuida la batería).
    const ajustar = () => {
      const escala = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
      canvas.width = Math.max(1, Math.round(window.innerWidth * escala));
      canvas.height = Math.max(1, Math.round(window.innerHeight * escala));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    ajustar();

    let objX = 0.3;
    let objY = 0.4;
    let x = objX;
    let y = objY;
    const inicio = performance.now();
    let raf = 0;
    const dibujar = (ahora: number) => {
      x += (objX - x) * 0.05;
      y += (objY - y) * 0.05;
      gl.uniform1f(uT, quieto ? 0 : (ahora - inicio) / 1000);
      gl.uniform2f(uMouse, x, y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!quieto && !document.hidden) raf = requestAnimationFrame(dibujar);
    };
    const mover = (e: PointerEvent) => {
      objX = (e.clientX / window.innerWidth - 0.5) * 2;
      objY = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    const visibilidad = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(dibujar);
    };
    const alCambiarTamano = () => {
      ajustar();
      if (quieto) dibujar(inicio);
    };
    window.addEventListener('resize', alCambiarTamano);
    document.addEventListener('visibilitychange', visibilidad);
    if (conMouse && !quieto) window.addEventListener('pointermove', mover, { passive: true });
    raf = requestAnimationFrame(dibujar);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', alCambiarTamano);
      document.removeEventListener('visibilitychange', visibilidad);
      window.removeEventListener('pointermove', mover);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 size-full" />;
}
