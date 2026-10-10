import { describe, expect, it } from 'vitest';
import { type AccionIA, aplicarAcciones, type Borrador, borradorVacio, MAX_ITEMS, type ProductoMenu } from '../src/index.ts';

const menu: ProductoMenu[] = [
  { id: 'id-completa', ref: 'p1', nombre: 'Hamburguesa completa', activo: true },
  { id: 'id-coca', ref: 'p2', nombre: 'Coca-Cola 1,5 L', activo: true },
  { id: 'id-pascualina', ref: 'p3', nombre: 'Pascualina', activo: false },
];

const agregar = (producto: string, cantidad: number, notas: string | null = null): AccionIA => ({
  tipo: 'agregar',
  producto,
  cantidad,
  notas,
});
const aplicar = (acciones: AccionIA[], b: Borrador = borradorVacio()) => aplicarAcciones(b, acciones, menu);

describe('agregar', () => {
  it('agrega por referencia y guarda el uuid del producto', () => {
    const r = aplicar([agregar('p1', 2, ' sin tomate '), agregar('p2', 1)]);
    expect(r.borrador.items).toEqual([
      { producto_id: 'id-completa', cantidad: 2, notas: 'sin tomate' },
      { producto_id: 'id-coca', cantidad: 1 },
    ]);
    expect(r.errores).toEqual([]);
  });

  it('suma cantidades del mismo producto con las mismas notas', () => {
    const r = aplicar([agregar('p1', 2), agregar('p1', 1)]);
    expect(r.borrador.items).toEqual([{ producto_id: 'id-completa', cantidad: 3 }]);
  });

  it('rechaza producto que no está en el menú (nunca inventa)', () => {
    const r = aplicar([agregar('p99', 1), agregar('uuid-inventado', 1)]);
    expect(r.borrador.items).toEqual([]);
    expect(r.errores).toHaveLength(2);
  });

  it('rechaza productos agotados', () => {
    const r = aplicar([agregar('p3', 1)]);
    expect(r.borrador.items).toEqual([]);
    expect(r.errores[0]).toContain('agotado');
  });

  it('rechaza cantidades absurdas sin tocar el resto', () => {
    const r = aplicar([agregar('p1', 500), agregar('p1', 0), agregar('p1', -2), agregar('p2', 1)]);
    expect(r.borrador.items).toEqual([{ producto_id: 'id-coca', cantidad: 1 }]);
    expect(r.errores).toHaveLength(3);
    // Solo lo que se pasa del máximo se le explica al cliente (0 o -2 es un error de la IA).
    expect(r.excedidos).toEqual([{ nombre: 'Hamburguesa completa', cantidad: 500 }]);
  });

  it('un agotado con cantidad grande es agotado, no excedido', () => {
    expect(aplicar([agregar('p3', 100)]).excedidos).toEqual([]);
  });

  it('rechaza si sumando se pasa del máximo', () => {
    const r = aplicar([agregar('p1', 15), agregar('p1', 10)]);
    expect(r.borrador.items).toEqual([{ producto_id: 'id-completa', cantidad: 15 }]);
    expect(r.errores).toHaveLength(1);
    expect(r.excedidos).toEqual([{ nombre: 'Hamburguesa completa', cantidad: 25 }]);
  });

  it('rechaza notas demasiado largas', () => {
    const r = aplicar([agregar('p1', 1, 'x'.repeat(201))]);
    expect(r.borrador.items).toEqual([]);
    expect(r.errores).toHaveLength(1);
  });

  it('no pasa del máximo de líneas', () => {
    const acciones = Array.from({ length: MAX_ITEMS + 2 }, (_, i) => agregar('p2', 1, `nota ${i}`));
    const r = aplicar(acciones);
    expect(r.borrador.items).toHaveLength(MAX_ITEMS);
    expect(r.errores).toHaveLength(2);
  });
});

describe('quitar', () => {
  it('"mejor sacame la coca" quita todas las líneas de ese producto', () => {
    const inicial = aplicar([agregar('p1', 2), agregar('p2', 1), agregar('p2', 1, 'bien fría')]).borrador;
    const r = aplicar([{ tipo: 'quitar', producto: 'p2' }], inicial);
    expect(r.borrador.items).toEqual([{ producto_id: 'id-completa', cantidad: 2 }]);
  });

  it('quitar algo que no estaba es un error, no rompe nada', () => {
    const r = aplicar([{ tipo: 'quitar', producto: 'p2' }]);
    expect(r.errores).toEqual(['Coca-Cola 1,5 L no estaba en el pedido']);
  });
});

describe('modificar', () => {
  const inicial = aplicar([agregar('p1', 2, 'sin tomate')]).borrador;

  it('cambia la cantidad y conserva las notas', () => {
    const r = aplicar([{ tipo: 'modificar', producto: 'p1', cantidad: 3, notas: null }], inicial);
    expect(r.borrador.items).toEqual([{ producto_id: 'id-completa', cantidad: 3, notas: 'sin tomate' }]);
  });

  it('cambia las notas y conserva la cantidad', () => {
    const r = aplicar([{ tipo: 'modificar', producto: 'p1', cantidad: null, notas: 'bien cocida' }], inicial);
    expect(r.borrador.items).toEqual([{ producto_id: 'id-completa', cantidad: 2, notas: 'bien cocida' }]);
  });

  it('si el producto no estaba y trae cantidad, lo agrega', () => {
    const r = aplicar([{ tipo: 'modificar', producto: 'p2', cantidad: 2, notas: null }], inicial);
    expect(r.borrador.items).toHaveLength(2);
    expect(r.borrador.items[1]).toEqual({ producto_id: 'id-coca', cantidad: 2 });
  });

  it('con varias líneas del mismo producto no adivina', () => {
    const dos = aplicar([agregar('p1', 1)], inicial).borrador;
    const r = aplicar([{ tipo: 'modificar', producto: 'p1', cantidad: 5, notas: null }], dos);
    expect(r.borrador).toBe(dos);
    expect(r.errores).toHaveLength(1);
  });

  it('rechaza cantidad absurda', () => {
    const r = aplicar([{ tipo: 'modificar', producto: 'p1', cantidad: 100, notas: null }], inicial);
    expect(r.borrador).toBe(inicial);
    expect(r.errores).toHaveLength(1);
  });
});

describe('entrega', () => {
  const entrega = (modo: 'retiro' | 'delivery' | 'mesa', direccion: string | null = null, mesa: string | null = null): AccionIA => ({
    tipo: 'entrega',
    modo,
    direccion,
    mesa,
  });

  it('delivery con dirección', () => {
    expect(aplicar([entrega('delivery', ' Blandengues 450 ')]).borrador.entrega).toEqual({
      modo: 'delivery',
      direccion: 'Blandengues 450',
    });
  });

  it('delivery sin dirección queda pendiente', () => {
    expect(aplicar([entrega('delivery')]).borrador.entrega).toEqual({ modo: 'delivery' });
  });

  it('conserva la dirección si después solo repite el modo', () => {
    const r = aplicar([entrega('delivery', 'Uruguay 1234'), entrega('delivery')]);
    expect(r.borrador.entrega).toEqual({ modo: 'delivery', direccion: 'Uruguay 1234' });
  });

  it('pasar a retiro borra la dirección', () => {
    const r = aplicar([entrega('delivery', 'Uruguay 1234'), entrega('retiro')]);
    expect(r.borrador.entrega).toEqual({ modo: 'retiro' });
  });

  it('mesa', () => {
    expect(aplicar([entrega('mesa', null, '4')]).borrador.entrega).toEqual({ modo: 'mesa', mesa: '4' });
  });

  it('rechaza dirección demasiado larga', () => {
    const r = aplicar([entrega('delivery', 'x'.repeat(201))]);
    expect(r.borrador.entrega).toBeNull();
    expect(r.errores).toHaveLength(1);
  });
});

describe('dudoso y aclarar', () => {
  it('"lo de siempre" queda como dudoso, sin tocar el pedido', () => {
    const r = aplicar([
      { tipo: 'dudoso', texto_original: 'una de las de siempre' },
      { tipo: 'aclarar', pregunta: '¿La coca es de 1,5 o de 2,25?' },
    ]);
    expect(r.borrador.items).toEqual([]);
    expect(r.dudosos).toEqual(['una de las de siempre']);
    expect(r.preguntas).toEqual(['¿La coca es de 1,5 o de 2,25?']);
  });

  it('ignora textos vacíos', () => {
    const r = aplicar([
      { tipo: 'dudoso', texto_original: '  ' },
      { tipo: 'aclarar', pregunta: '' },
    ]);
    expect(r.dudosos).toEqual([]);
    expect(r.preguntas).toEqual([]);
  });
});

it('es pura: no muta el borrador de entrada', () => {
  const inicial = aplicar([agregar('p1', 1)]).borrador;
  const copia = JSON.parse(JSON.stringify(inicial)) as typeof inicial;
  aplicar([agregar('p1', 1), { tipo: 'quitar', producto: 'p1' }, agregar('p2', 3)], inicial);
  expect(inicial).toEqual(copia);
});

it('recorta dudosos y preguntas largos que vengan de la IA', () => {
  const r = aplicar([
    { tipo: 'dudoso', texto_original: 'x'.repeat(5000) },
    { tipo: 'aclarar', pregunta: 'y'.repeat(5000) },
  ]);
  expect(r.dudosos[0]).toHaveLength(300);
  expect(r.preguntas[0]).toHaveLength(300);
});

describe('consultar', () => {
  it('devuelve los productos activos que responden, sin repetir y sin tocar el pedido', () => {
    const r = aplicar([{ tipo: 'consultar', productos: ['p2', 'p1', 'p2', 'p3', 'p99'] }]);
    expect(r.consulta).toEqual(['id-coca', 'id-completa']);
    expect(r.borrador).toEqual(borradorVacio());
    expect(r.errores).toEqual([]);
  });

  it('sin coincidencias queda vacía (no hay), y sin consultar es null', () => {
    expect(aplicar([{ tipo: 'consultar', productos: [] }]).consulta).toEqual([]);
    expect(aplicar([agregar('p1', 1)]).consulta).toBeNull();
  });
});

describe('dudoso que suena igual a un producto', () => {
  const conClaves: ProductoMenu[] = [
    { id: 'id-birra', ref: 'p1', nombre: 'Cerveza Pilsen 1 L', activo: true, claves: ['Cerveza Pilsen 1 L', 'birra'] },
    { id: 'id-muzza', ref: 'p2', nombre: 'Pizza muzzarella', activo: true, claves: ['Pizza muzzarella', 'muzza'] },
    { id: 'id-pascua', ref: 'p3', nombre: 'Pascualina', activo: false, claves: ['Pascualina'] },
  ];
  const aplicarCon = (acciones: AccionIA[]) => aplicarAcciones(borradorVacio(), acciones, conClaves);

  it('lo agrega con su cantidad en vez de dejarlo dudoso', () => {
    const r = aplicarCon([{ tipo: 'dudoso', texto_original: '2 virras' }]);
    expect(r.borrador.items).toEqual([{ producto_id: 'id-birra', cantidad: 2 }]);
    expect(r.dudosos).toEqual([]);
  });

  it('lo que no suena a nada, o suena a un agotado, sigue dudoso', () => {
    const r = aplicarCon([
      { tipo: 'dudoso', texto_original: 'lo de siempre' },
      { tipo: 'dudoso', texto_original: 'pascualina' },
    ]);
    expect(r.borrador.items).toEqual([]);
    expect(r.dudosos).toEqual(['lo de siempre', 'pascualina']);
  });
});
