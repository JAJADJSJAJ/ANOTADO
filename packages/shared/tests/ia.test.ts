import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agregarItem,
  borradorVacio,
  construirMensajes,
  construirMenu,
  ErrorIA,
  ESQUEMA_RESPUESTA,
  llamarIA,
} from '../src/index.ts';

const productos = [
  { id: 'id-coca', nombre: 'Coca-Cola 1,5 L', alias: ['coca grande'], activo: true },
  { id: 'id-completa', nombre: 'Hamburguesa completa', alias: ['completa', 'compl'], activo: true },
  { id: 'id-pascualina', nombre: 'Pascualina', alias: [], activo: false },
];

describe('construirMenu', () => {
  it('solo activos, orden por nombre, refs cortas y sin precios', () => {
    const { texto, menu } = construirMenu(productos);
    expect(texto).toBe('p1 | Coca-Cola 1,5 L | coca grande\np2 | Hamburguesa completa | completa, compl');
    expect(menu.map((p) => [p.ref, p.id])).toEqual([
      ['p1', 'id-coca'],
      ['p2', 'id-completa'],
    ]);
  });

  it('es estable: mismo menú, mismo texto (para el cacheo)', () => {
    expect(construirMenu([...productos].reverse()).texto).toBe(construirMenu(productos).texto);
  });
});

describe('construirMensajes', () => {
  const { texto, menu } = construirMenu(productos);
  const borrador = agregarItem(borradorVacio(), 'id-completa', 2, 'sin tomate');

  it('pone instrucciones y menú en system, y separa el mensaje nuevo del contexto', () => {
    const [system, user] = construirMensajes(texto, menu, borrador, [
      { rol: 'cliente', contenido: 'hola, 2 completas sin tomate' },
      { rol: 'cliente', contenido: 'y una coca grande' },
    ]);
    expect(system!.content).toContain('p2 | Hamburguesa completa');
    expect(user!.content).toContain('"producto":"p2"');
    expect(user!.content).not.toContain('id-completa');
    expect(user!.content).toContain('MENSAJES ANTERIORES:\n[cliente] hola, 2 completas sin tomate');
    expect(user!.content).toMatch(/MENSAJE NUEVO DEL CLIENTE:\ny una coca grande$/);
  });
});

describe('ESQUEMA_RESPUESTA', () => {
  it('queda en el subconjunto del modo estricto', () => {
    const json = JSON.stringify(ESQUEMA_RESPUESTA);
    for (const prohibido of ['"oneOf"', '"$schema"', '"minimum"', '"maximum"', '"maxItems"']) {
      expect(json).not.toContain(prohibido);
    }
    expect(json).toContain('"anyOf"');
  });
});

describe('llamarIA', () => {
  const config = { baseUrl: 'https://ia.test/v1/', apiKey: 'k', modelo: 'modelo-x' };
  const mensajes = [{ role: 'user' as const, content: 'hola' }];
  const respuestaOk = { acciones: [{ tipo: 'dudoso', texto_original: 'lo de siempre' }], listo_para_confirmar: false };

  const respuestaHttp = (contenido: string, status = 200) =>
    new Response(
      JSON.stringify({
        model: 'modelo-x',
        choices: [{ message: { content: contenido } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
      { status },
    );

  afterEach(() => vi.unstubAllGlobals());

  it('valida y devuelve acciones y tokens', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaHttp(JSON.stringify(respuestaOk)));
    vi.stubGlobal('fetch', fetchFalso);

    const r = await llamarIA(config, mensajes);
    expect(r.respuesta).toEqual(respuestaOk);
    expect(r.tokensEntrada).toBe(120);
    expect(r.tokensSalida).toBe(30);

    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toBe('https://ia.test/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('modelo-x');
    expect(body.temperature).toBe(0);
    expect(body.response_format.type).toBe('json_schema');
  });

  it('acepta JSON envuelto en ```json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuestaHttp('```json\n' + JSON.stringify(respuestaOk) + '\n```')));
    expect((await llamarIA(config, mensajes)).respuesta).toEqual(respuestaOk);
  });

  it('JSON inválido: reintenta una vez y después falla', async () => {
    const fetchFalso = vi.fn().mockImplementation(async () => respuestaHttp('no es json'));
    vi.stubGlobal('fetch', fetchFalso);
    await expect(llamarIA(config, mensajes)).rejects.toBeInstanceOf(ErrorIA);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('formato inesperado (acción inventada) se rechaza', async () => {
    const malo = { acciones: [{ tipo: 'cambiar_precio', precio: 0 }], listo_para_confirmar: true };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => respuestaHttp(JSON.stringify(malo))));
    await expect(llamarIA(config, mensajes)).rejects.toThrow('formato esperado');
  });

  it('error 500: reintenta y si el segundo sale bien, sigue', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(new Response('caído', { status: 500 }))
      .mockResolvedValueOnce(respuestaHttp(JSON.stringify(respuestaOk)));
    vi.stubGlobal('fetch', fetchFalso);
    expect((await llamarIA(config, mensajes)).respuesta).toEqual(respuestaOk);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('error 401 (key mala): no reintenta', async () => {
    const fetchFalso = vi.fn().mockImplementation(async () => new Response('no autorizado', { status: 401 }));
    vi.stubGlobal('fetch', fetchFalso);
    await expect(llamarIA(config, mensajes)).rejects.toThrow('401');
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});

describe('RespuestaIASchema', () => {
  it('acepta campos omitidos como null (modelos en modo JSON simple)', async () => {
    const { RespuestaIASchema } = await import('../src/index.ts');
    const r = RespuestaIASchema.parse({
      acciones: [
        { tipo: 'agregar', producto: 'p1', cantidad: 2 },
        { tipo: 'entrega', modo: 'retiro' },
      ],
      listo_para_confirmar: false,
    });
    expect(r.acciones).toEqual([
      { tipo: 'agregar', producto: 'p1', cantidad: 2, notas: null },
      { tipo: 'entrega', modo: 'retiro', direccion: null, mesa: null },
    ]);
  });
});
