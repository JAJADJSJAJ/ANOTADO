import { formatearPrecio, parsearPrecio } from '@anotado/shared';
import { type FormEvent, useState } from 'react';
import { type Zona, useZonas } from '../hooks/useZonas.ts';
import { usePreguntar } from '../lib/dialogos.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { MensajeError, Vacio } from './Estado.tsx';
import { Icono } from './Icono.tsx';
import { Interruptor } from './Interruptor.tsx';

/**
 * Zonas de envío del local (dueño). El costo se suma al total al confirmar un delivery; lo
 * pone la base, no la pantalla. Si hay zonas activas, todo delivery tiene que elegir una.
 */
export function ZonasEnvio({ negocioId }: { negocioId: string }) {
  const { zonas, error: errorCarga, recargar } = useZonas(negocioId);
  const [error, setError] = useState<string | null>(null);
  const preguntar = usePreguntar();

  async function guardar(accion: PromiseLike<{ error: { message: string; code?: string } | null }>) {
    setError(null);
    const { error } = await accion;
    if (error) {
      efecto('error');
      setError(error.code === '23505' ? 'Ya hay una zona con ese nombre.' : error.message);
      return false;
    }
    await recargar();
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      <NuevaZona
        onCrear={(nombre, costo) =>
          guardar(
            supabase.from('zonas_envio').insert({
              negocio_id: negocioId,
              nombre,
              costo_centavos: costo,
              orden: Math.max(0, ...zonas.map((z) => z.orden)) + 1,
            }),
          )
        }
      />
      {(error ?? errorCarga) && <MensajeError>{error ?? errorCarga}</MensajeError>}
      <section className="tarjeta">
        {zonas.length === 0 ? (
          <Vacio icono="moto" titulo="Sin zonas de envío">
            Sin zonas, el delivery se toma sin costo de envío.
          </Vacio>
        ) : (
          <ul className="divide-y divide-linea">
            {zonas.map((z) => (
              <FilaZona
                key={z.id}
                zona={z}
                onActiva={(activa) => void guardar(supabase.from('zonas_envio').update({ activa }).eq('id', z.id))}
                onBorrar={async () => {
                  const ok = await preguntar({
                    titulo: `¿Borrar la zona "${z.nombre}"?`,
                    texto: 'Los pedidos que ya la usaron la conservan.',
                    aceptar: 'Borrar',
                    peligro: true,
                  });
                  if (ok !== null) void guardar(supabase.from('zonas_envio').delete().eq('id', z.id));
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilaZona({ zona, onActiva, onBorrar }: { zona: Zona; onActiva: (a: boolean) => void; onBorrar: () => void }) {
  return (
    <li className="flex animate-entra items-center gap-4 px-5 py-3.5">
      <Interruptor prendido={zona.activa} onCambio={onActiva} etiqueta={`Zona ${zona.nombre} activa`} />
      <span className={`min-w-0 flex-1 truncate font-semibold ${zona.activa ? '' : 'text-tinta-3'}`}>
        {zona.nombre}
        {!zona.activa && <span className="ml-2 text-sm font-normal">pausada</span>}
      </span>
      <span className={`num font-semibold ${zona.activa ? '' : 'text-tinta-3'}`}>{formatearPrecio(zona.costo_centavos)}</span>
      <button type="button" className="btn btn-quitar btn-icono" aria-label={`Borrar la zona ${zona.nombre}`} title="Borrar" onClick={onBorrar}>
        <Icono nombre="cerrar" className="size-4" />
      </button>
    </li>
  );
}

function NuevaZona({ onCrear }: { onCrear: (nombre: string, costo: number) => Promise<boolean> }) {
  const [nombre, setNombre] = useState('');
  const [costo, setCosto] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const centavos = parsearPrecio(costo);
    if (!nombre.trim()) return setError('Falta el nombre de la zona.');
    if (centavos === null) return setError('Costo inválido. Ej: 80, o 0 si es gratis.');
    setError(null);
    if (await onCrear(nombre.trim(), centavos)) {
      efecto('ok');
      setNombre('');
      setCosto('');
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1">
          <span className="etiqueta">Zona nueva</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Centro" maxLength={60} className="campo" />
        </label>
        <label className="w-32">
          <span className="etiqueta">Costo</span>
          <span className="relative block">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-tinta-3">$</span>
            <input value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="80" inputMode="decimal" className="campo num pl-7" />
          </span>
        </label>
        <button type="submit" className="btn btn-tinta h-11" data-sonido="no">
          <Icono nombre="mas" />
          Agregar
        </button>
      </div>
      {error && <MensajeError>{error}</MensajeError>}
    </form>
  );
}
