import { describe, expect, it } from 'vitest';
import { ConfirmarPedidoSchema, EntregaSchema, MAX_CANTIDAD } from '../src/index.ts';

const COCA = '22222222-2222-4222-8222-222222222222';

describe('EntregaSchema', () => {
  it('acepta los tres modos', () => {
    expect(EntregaSchema.parse({ modo: 'retiro' })).toEqual({ modo: 'retiro' });
    expect(EntregaSchema.parse({ modo: 'delivery', direccion: ' Blandengues 450 ' })).toEqual({
      modo: 'delivery',
      direccion: 'Blandengues 450',
    });
    expect(EntregaSchema.parse({ modo: 'mesa', mesa: '4' })).toEqual({ modo: 'mesa', mesa: '4' });
  });

  it('delivery sin dirección falla', () => {
    expect(EntregaSchema.safeParse({ modo: 'delivery', direccion: '  ' }).success).toBe(false);
    expect(EntregaSchema.safeParse({ modo: 'delivery' }).success).toBe(false);
  });

  it('descarta campos extra', () => {
    expect(EntregaSchema.parse({ modo: 'retiro', total: 0 })).toEqual({ modo: 'retiro' });
  });
});

describe('ConfirmarPedidoSchema', () => {
  const valido = { origen: 'mostrador', items: [{ producto_id: COCA, cantidad: 1 }], entrega: null };

  it('acepta un pedido válido', () => {
    expect(ConfirmarPedidoSchema.safeParse(valido).success).toBe(true);
  });

  it('rechaza pedido vacío', () => {
    expect(ConfirmarPedidoSchema.safeParse({ ...valido, items: [] }).success).toBe(false);
  });

  it('rechaza cantidades fuera de rango o con decimales', () => {
    for (const cantidad of [0, MAX_CANTIDAD + 1, 1.5]) {
      const r = ConfirmarPedidoSchema.safeParse({ ...valido, items: [{ producto_id: COCA, cantidad }] });
      expect(r.success, `cantidad ${cantidad}`).toBe(false);
    }
  });

  it('rechaza producto_id que no es uuid', () => {
    const r = ConfirmarPedidoSchema.safeParse({ ...valido, items: [{ producto_id: 'coca', cantidad: 1 }] });
    expect(r.success).toBe(false);
  });
});

describe('BorradorSchema', () => {
  it('descarta campos extra (precios, totales) que mande el navegador', async () => {
    const { BorradorSchema } = await import('../src/index.ts');
    const b = BorradorSchema.parse({
      items: [{ producto_id: COCA, cantidad: 1, precio_centavos: 1, descuento: 100 }],
      entrega: null,
      total_centavos: 0,
    });
    expect(b).toEqual({ items: [{ producto_id: COCA, cantidad: 1 }], entrega: null });
  });
});
