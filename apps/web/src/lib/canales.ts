import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';

// Una sola suscripción de Realtime por canal privado y evento, compartida por todas las
// pantallas que lo escuchan en la misma página. Suscribirse dos veces al mismo canal (el
// mostrador y la cocina juntos en el simulador de la demo) hace fallar la segunda.

export type Oyente = {
  onAviso: (payload: unknown) => void;
  /** SUBSCRIBED (también después de cada reconexión), CHANNEL_ERROR, TIMED_OUT, CLOSED. */
  onEstado: (estado: string) => void;
};

type Compartido = { canal: RealtimeChannel; oyentes: Set<Oyente>; estado: string | null };

const canales = new Map<string, Compartido>();

/** Escucha un evento broadcast de un canal privado. Devuelve la función para dejar de escuchar. */
export function escucharCanal(topic: string, evento: string, oyente: Oyente): () => void {
  const clave = `${topic}#${evento}`;
  let compartido = canales.get(clave);
  if (!compartido) {
    const nuevo: Compartido = { canal: supabase.channel(topic, { config: { private: true } }), oyentes: new Set(), estado: null };
    nuevo.canal
      .on('broadcast', { event: evento }, ({ payload }) => {
        for (const o of nuevo.oyentes) o.onAviso(payload);
      })
      .subscribe((estado) => {
        nuevo.estado = estado;
        for (const o of nuevo.oyentes) o.onEstado(estado);
      });
    canales.set(clave, nuevo);
    compartido = nuevo;
  }
  compartido.oyentes.add(oyente);
  // Quien llega tarde se entera del estado actual (si ya estaba suscripto, recarga igual).
  if (compartido.estado) oyente.onEstado(compartido.estado);

  const actual = compartido;
  return () => {
    actual.oyentes.delete(oyente);
    if (actual.oyentes.size === 0 && canales.get(clave) === actual) {
      canales.delete(clave);
      void supabase.removeChannel(actual.canal);
    }
  };
}
