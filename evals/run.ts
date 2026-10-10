// Corre los casos de evals/casos contra un modelo y reporta % de aciertos por categoría.
//
//   pnpm eval                  todos los casos
//   pnpm eval notas cambio     solo los casos cuyo id contiene alguno de esos textos
//
// Config en evals/.env (ignorado por git, ver .env.example). Gasta tokens: no corre en CI.

import {
  aplicarAcciones,
  type Borrador,
  borradorVacio,
  type ConfigIA,
  construirMensajes,
  construirMenu,
  llamarIA,
  type MensajeHistorial,
  type ProductoParaMenu,
} from '@anotado/shared';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type ItemEsperado = { producto: string; cantidad: number; notas?: string };
type Caso = {
  id: string;
  categoria: string;
  menu: string;
  /** Lo que escribe el cliente; { bot } es una respuesta del bot en el medio (contexto). */
  mensajes: (string | { bot: string })[];
  esperado: {
    items: ItemEsperado[];
    /** Omitido: no se chequea. null: no debe haber entrega. */
    entrega?: { modo: string; direccion?: string; mesa?: string } | null;
    /** Tiene que marcar al menos un dudoso o hacer una pregunta. Si no, no debe haber dudosos. */
    debe_dudar?: boolean;
    /** Algo tiene que quedar rechazado, dudoso o preguntado (cantidades absurdas). */
    rechazado?: boolean;
  };
};

const MAX_HISTORIAL = 6;
const aqui = import.meta.dirname;

const config: ConfigIA = {
  baseUrl: requerida('IA_BASE_URL'),
  apiKey: requerida('IA_API_KEY'),
  modelo: requerida('IA_MODELO'),
  formato: process.env.IA_FORMATO === 'json_object' ? 'json_object' : 'json_schema',
  headers: { 'X-Title': 'Anotado evals' },
  cuerpoExtra: process.env.IA_EXTRA ? (JSON.parse(process.env.IA_EXTRA) as Record<string, unknown>) : undefined,
};
const precioEntrada = Number(process.env.IA_PRECIO_ENTRADA ?? 0); // US$ por millón de tokens
const precioSalida = Number(process.env.IA_PRECIO_SALIDA ?? 0);

const filtros = process.argv.slice(2);
const casos = readdirSync(join(aqui, 'casos'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(aqui, 'casos', f), 'utf8')) as Caso)
  .filter((c) => filtros.length === 0 || filtros.some((f) => c.id.includes(f)))
  .sort((a, b) => a.id.localeCompare(b.id));

const menus = new Map<string, ReturnType<typeof construirMenu>>();
const menuDe = (nombre: string) => {
  if (!menus.has(nombre)) {
    const productos = JSON.parse(readFileSync(join(aqui, 'menus', `${nombre}.json`), 'utf8')) as ProductoParaMenu[];
    menus.set(nombre, construirMenu(productos));
  }
  return menus.get(nombre)!;
};

console.log(`Modelo: ${config.modelo} · ${casos.length} casos\n`);

const resultados = [];
let tokensEntrada = 0;
let tokensSalida = 0;

for (const caso of casos) {
  const { texto, menu } = menuDe(caso.menu);
  const historial: MensajeHistorial[] = [];
  let borrador: Borrador = borradorVacio();
  const dudosos: string[] = [];
  const preguntas: string[] = [];
  const errores: string[] = [];
  let fallaIA: string | null = null;
  const respuestas: unknown[] = [];
  const inicio = Date.now();

  // Igual que parse-order: un mensaje a la vez, con el borrador acumulado.
  for (const mensaje of caso.mensajes) {
    if (typeof mensaje !== 'string') {
      historial.push({ rol: 'asistente', contenido: mensaje.bot });
      continue;
    }
    historial.push({ rol: 'cliente', contenido: mensaje });
    try {
      const r = await llamarIA(config, construirMensajes(texto, menu, borrador, historial.slice(-MAX_HISTORIAL)));
      tokensEntrada += r.tokensEntrada;
      tokensSalida += r.tokensSalida;
      respuestas.push(r.respuesta);
      const aplicado = aplicarAcciones(borrador, r.respuesta.acciones, menu);
      borrador = aplicado.borrador;
      dudosos.push(...aplicado.dudosos);
      preguntas.push(...aplicado.preguntas);
      errores.push(...aplicado.errores);
    } catch (e) {
      fallaIA = (e as Error).message;
      break;
    }
  }

  const nombres = new Map(menu.map((p) => [p.id, p.nombre]));
  const obtenido = borrador.items.map((it) => ({
    producto: nombres.get(it.producto_id) ?? it.producto_id,
    cantidad: it.cantidad,
    notas: it.notas,
  }));
  const problemas = fallaIA ? [`falla de la IA: ${fallaIA}`] : comparar(caso, borrador, obtenido, dudosos, preguntas, errores);
  const ok = problemas.length === 0;

  console.log(`${ok ? '✓' : '✗'} ${caso.id.padEnd(18)} ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  if (!ok) {
    for (const p of problemas) console.log(`    - ${p}`);
    console.log(`    obtenido: ${JSON.stringify({ items: obtenido, entrega: borrador.entrega, dudosos, preguntas, errores })}`);
  }
  resultados.push({ id: caso.id, categoria: caso.categoria, ok, problemas, obtenido, entrega: borrador.entrega, dudosos, preguntas, errores, respuestas });
}

// Resumen por categoría.
const categorias = [...new Set(resultados.map((r) => r.categoria))].sort();
console.log('\nCategoría              Aciertos');
for (const cat of categorias) {
  const deCat = resultados.filter((r) => r.categoria === cat);
  const bien = deCat.filter((r) => r.ok).length;
  console.log(`${cat.padEnd(22)} ${bien}/${deCat.length}`);
}
const total = resultados.filter((r) => r.ok).length;
const costo = (tokensEntrada * precioEntrada + tokensSalida * precioSalida) / 1_000_000;
console.log(`\nTOTAL ${total}/${resultados.length} (${Math.round((100 * total) / Math.max(resultados.length, 1))}%)`);
console.log(`Tokens: ${tokensEntrada} entrada · ${tokensSalida} salida${costo ? ` · US$ ${costo.toFixed(4)}` : ''}`);

mkdirSync(join(aqui, 'resultados'), { recursive: true });
const archivo = join(aqui, 'resultados', `${config.modelo.replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`);
writeFileSync(archivo, JSON.stringify({ modelo: config.modelo, total, casos: resultados.length, tokensEntrada, tokensSalida, resultados }, null, 2));
console.log(`Detalle: ${archivo}`);

function comparar(
  caso: Caso,
  borrador: Borrador,
  obtenido: { producto: string; cantidad: number; notas?: string }[],
  dudosos: string[],
  preguntas: string[],
  errores: string[],
): string[] {
  const e = caso.esperado;
  const problemas: string[] = [];

  // Items: cada esperado tiene que aparecer exactamente una vez (producto + cantidad + notas).
  const pendientes = [...obtenido];
  for (const esp of e.items) {
    const i = pendientes.findIndex(
      (o) =>
        o.producto === esp.producto &&
        o.cantidad === esp.cantidad &&
        (esp.notas ? normalizar(o.notas ?? '').includes(normalizar(esp.notas)) : true),
    );
    if (i < 0) problemas.push(`falta ${esp.cantidad} × ${esp.producto}${esp.notas ? ` (${esp.notas})` : ''}`);
    else pendientes.splice(i, 1);
  }
  for (const sobra of pendientes) problemas.push(`sobra ${sobra.cantidad} × ${sobra.producto}`);

  if (e.entrega === null && borrador.entrega !== null) problemas.push('no debía haber entrega');
  if (e.entrega) {
    const obt = borrador.entrega;
    if (obt?.modo !== e.entrega.modo) problemas.push(`entrega: esperaba ${e.entrega.modo}, obtuvo ${obt?.modo ?? 'nada'}`);
    else if (e.entrega.direccion && !(obt.modo === 'delivery' && normalizar(obt.direccion ?? '').includes(normalizar(e.entrega.direccion)))) {
      problemas.push(`dirección: esperaba "${e.entrega.direccion}"`);
    }
  }

  const dudo = dudosos.length > 0 || preguntas.length > 0;
  if (e.debe_dudar && !dudo) problemas.push('debía marcar dudoso o preguntar');
  if (!e.debe_dudar && !e.rechazado && dudosos.length > 0) problemas.push(`dudosos de más: ${dudosos.join(' | ')}`);
  if (e.rechazado && !dudo && errores.length === 0) problemas.push('debía rechazar o dudar');

  return problemas;
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`Falta ${nombre}. Copiá evals/.env.example a evals/.env y completalo.`);
    process.exit(1);
  }
  return valor;
}
