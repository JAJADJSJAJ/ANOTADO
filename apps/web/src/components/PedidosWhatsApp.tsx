import { BorradorSchema, borradorVacio, PendientesSchema } from '@anotado/shared';
import { useEffect, useState } from 'react';
import type { Producto } from '../hooks/useMenu.ts';
import type { PedidoConfirmado } from '../lib/pedidos.ts';
import { supabase } from '../lib/supabase.ts';
import { Cargando, MensajeError } from './Estado.tsx';
import { type DatosTarjeta, TarjetaWhatsApp } from './TarjetaWhatsApp.tsx';

type Tarjeta = { clave: string; datos: DatosTarjeta };

const TARJETA_NUEVA: DatosTarjeta = {
  conversacionId: null,
  version: null,
  etiqueta: '',
  borrador: borradorVacio(),
  pendientes: { dudosos: [], preguntas: [], errores: [] },
};

let contador = 0;
const nuevaClave = () => `t${++contador}`;

/**
 * Tarjetas de WhatsApp: una por cliente. Al entrar se recuperan las conversaciones abiertas,
 * así recargar la página no pierde nada.
 */
export function PedidosWhatsApp({
  negocioId,
  productos,
  activos,
  onConfirmado,
}: {
  negocioId: string;
  productos: ReadonlyMap<string, Producto>;
  activos: Producto[];
  onConfirmado: (pedido: PedidoConfirmado, etiqueta: string) => void;
}) {
  const [tarjetas, setTarjetas] = useState<Tarjeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('conversaciones')
      .select('id, version, etiqueta, borrador, pendientes')
      .eq('negocio_id', negocioId)
      .eq('estado', 'abierta')
      .order('created_at')
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        setTarjetas(
          data.map((c) => ({
            clave: c.id,
            datos: {
              conversacionId: c.id,
              version: c.version,
              etiqueta: c.etiqueta ?? '',
              borrador: BorradorSchema.catch(borradorVacio()).parse(c.borrador),
              pendientes: PendientesSchema.catch({ dudosos: [], preguntas: [], errores: [] }).parse(c.pendientes),
            },
          })),
        );
      });
  }, [negocioId]);

  const quitar = (clave: string) => setTarjetas((ts) => (ts ?? []).filter((t) => t.clave !== clave));

  if (error) return <MensajeError>{error}</MensajeError>;
  if (!tarjetas) return <Cargando />;

  return (
    <section aria-label="Pedidos de WhatsApp" className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setTarjetas((ts) => [...(ts ?? []), { clave: nuevaClave(), datos: TARJETA_NUEVA }])}
        className="self-start rounded-xl bg-emerald-600 px-5 py-4 text-lg font-bold text-white active:bg-emerald-700"
      >
        + Nuevo pedido de WhatsApp
      </button>

      {tarjetas.length === 0 && (
        <p className="text-lg text-neutral-600">
          No hay pedidos de WhatsApp en curso. Tocá el botón de arriba cuando escriba un cliente.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {tarjetas.map((t) => (
          <TarjetaWhatsApp
            key={t.clave}
            negocioId={negocioId}
            inicial={t.datos}
            productos={productos}
            activos={activos}
            onCerrada={(pedido, etiqueta) => {
              quitar(t.clave);
              if (pedido) onConfirmado(pedido, etiqueta);
            }}
          />
        ))}
      </div>
    </section>
  );
}
