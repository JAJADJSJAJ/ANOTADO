import { formatearPrecio, parsearPrecio } from '@anotado/shared';
import { type FormEvent, useState } from 'react';
import { type Zona, useZonas } from '../hooks/useZonas.ts';
import { supabase } from '../lib/supabase.ts';
import { MensajeError } from './Estado.tsx';

const input = 'rounded-lg border-2 border-stone-300 px-3 py-2 text-lg';

/**
 * Zonas de envío del local (dueño). El costo se suma al total al confirmar un delivery; lo
 * pone la base, no la pantalla. Si hay zonas activas, todo delivery tiene que elegir una.
 */
export function ZonasEnvio({ negocioId }: { negocioId: string }) {
  const { zonas, error: errorCarga, recargar } = useZonas(negocioId);
  const [error, setError] = useState<string | null>(null);

  async function guardar(accion: PromiseLike<{ error: { message: string; code?: string } | null }>) {
    setError(null);
    const { error } = await accion;
    if (error) {
      setError(error.code === '23505' ? 'Ya hay una zona con ese nombre.' : error.message);
      return false;
    }
    await recargar();
    return true;
  }

  return (
    <div className="flex flex-col gap-3">
      {(error ?? errorCarga) && <MensajeError>{error ?? errorCarga}</MensajeError>}
      {zonas.length > 0 && (
        <ul className="divide-y divide-stone-200">
          {zonas.map((z) => (
            <FilaZona
              key={z.id}
              zona={z}
              onActiva={(activa) => void guardar(supabase.from('zonas_envio').update({ activa }).eq('id', z.id))}
              onBorrar={() => {
                if (!confirm(`¿Borrar la zona "${z.nombre}"? Los pedidos viejos la conservan.`)) return;
                void guardar(supabase.from('zonas_envio').delete().eq('id', z.id));
              }}
            />
          ))}
        </ul>
      )}
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
    </div>
  );
}

function FilaZona({ zona, onActiva, onBorrar }: { zona: Zona; onActiva: (a: boolean) => void; onBorrar: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className={`min-w-32 flex-1 text-lg font-bold ${zona.activa ? '' : 'text-stone-400 line-through'}`}>
        {zona.nombre}
      </span>
      <span className="text-lg font-medium">{formatearPrecio(zona.costo_centavos)}</span>
      <button
        type="button"
        onClick={() => onActiva(!zona.activa)}
        className={`rounded-lg border-2 px-3 py-2 font-bold ${
          zona.activa ? 'border-emerald-600 text-emerald-700' : 'border-stone-400 text-stone-600'
        }`}
      >
        {zona.activa ? 'Activa' : 'Pausada'}
      </button>
      <button type="button" className="font-medium text-red-700 underline" onClick={onBorrar}>
        Borrar
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
    if (centavos === null) return setError('Costo inválido. Ej: 80 o 0 si es gratis.');
    setError(null);
    if (await onCrear(nombre.trim(), centavos)) {
      setNombre('');
      setCosto('');
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2 rounded-lg bg-stone-50 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Centro"
          maxLength={60}
          aria-label="Nombre de la zona"
          className={`${input} min-w-40 flex-1`}
        />
        <input
          value={costo}
          onChange={(e) => setCosto(e.target.value)}
          placeholder="Costo $"
          inputMode="decimal"
          aria-label="Costo del envío"
          className={`${input} w-32`}
        />
        <button type="submit" className="rounded-lg bg-stone-900 px-4 py-2 font-bold text-white">
          Agregar
        </button>
      </div>
      {error && <MensajeError>{error}</MensajeError>}
    </form>
  );
}
