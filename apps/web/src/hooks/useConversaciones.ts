import { type Borrador, BorradorSchema, borradorVacio, type Pendientes, PendientesSchema } from '@anotado/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.ts';

/** Red de seguridad: aunque Realtime muera callado, cada 30 s se recarga. */
const RECARGA_PERIODICA_MS = 30_000;
/** Un mensaje avisa dos veces (mensaje y conversación): una sola recarga. */
const ESPERA_AVISOS_MS = 250;
const MAX_MENSAJES = 1000;

export type TipoMensaje = 'texto' | 'audio' | 'imagen' | 'video' | 'documento' | 'ubicacion' | 'sticker' | 'contacto' | 'otro';

export type MensajeConversacion = {
  id: string;
  contenido: string;
  tipo: TipoMensaje;
  interpretado: boolean;
  created_at: string;
};

/** Una conversación abierta tal como está en la base. */
export type Conversacion = {
  id: string;
  version: number;
  etiqueta: string;
  borrador: Borrador;
  pendientes: Pendientes;
  /** null = tarjeta armada pegando mensajes (sin WhatsApp conectado). */
  cliente: { nombre: string | null; telefono: string } | null;
  mensajes: MensajeConversacion[];
  /** La IA la está interpretando ahora (tiene el turno). */
  interpretando: boolean;
};

const SIN_PENDIENTES: Pendientes = { dudosos: [], preguntas: [], errores: [] };

/**
 * Conversaciones abiertas del negocio, siempre al día. Igual que la cocina: los avisos de
 * Realtime solo dicen "algo cambió" y la lista sale siempre de la base (por RLS: solo dueño
 * y cajero). Se recarga al suscribirse (también al reconectar), al volver internet, al volver
 * a la pestaña y cada 30 s.
 */
export function useConversaciones(negocioId: string) {
  const [conversaciones, setConversaciones] = useState<Conversacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargando = useRef(false);
  const otraPendiente = useRef(false);

  const recargar = useCallback(async () => {
    if (cargando.current) {
      otraPendiente.current = true;
      return;
    }
    cargando.current = true;
    try {
      do {
        otraPendiente.current = false;
        const { data: convs, error: errConvs } = await supabase
          .from('conversaciones')
          .select('id, version, etiqueta, borrador, pendientes, interpretando_hasta, clientes(nombre, telefono)')
          .eq('negocio_id', negocioId)
          .eq('estado', 'abierta')
          .order('created_at');
        if (errConvs) {
          setError(errConvs.message);
          continue;
        }
        const ids = convs.map((c) => c.id);
        const { data: mensajes, error: errMensajes } = ids.length
          ? await supabase
              .from('mensajes')
              .select('id, conversacion_id, contenido, tipo, interpretado, created_at')
              .eq('negocio_id', negocioId)
              .in('conversacion_id', ids)
              // Los más nuevos primero: si se pasa del tope, se cortan los viejos, nunca los últimos.
              .order('orden', { ascending: false })
              .limit(MAX_MENSAJES)
          : { data: [], error: null };
        if (errMensajes) {
          setError(errMensajes.message);
          continue;
        }
        const porConversacion = new Map<string, MensajeConversacion[]>();
        for (const m of [...mensajes].reverse()) {
          const lista = porConversacion.get(m.conversacion_id) ?? [];
          lista.push({ ...m, tipo: m.tipo as TipoMensaje });
          porConversacion.set(m.conversacion_id, lista);
        }
        const ahora = Date.now();
        setConversaciones(
          convs.map((c) => ({
            id: c.id,
            version: c.version,
            etiqueta: c.etiqueta ?? '',
            borrador: BorradorSchema.catch(borradorVacio()).parse(c.borrador),
            pendientes: PendientesSchema.catch(SIN_PENDIENTES).parse(c.pendientes),
            cliente: c.clientes ? { nombre: c.clientes.nombre, telefono: c.clientes.telefono } : null,
            mensajes: porConversacion.get(c.id) ?? [],
            interpretando: !!c.interpretando_hasta && new Date(c.interpretando_hasta).getTime() > ahora,
          })),
        );
        setError(null);
      } while (otraPendiente.current);
    } finally {
      cargando.current = false;
    }
  }, [negocioId]);

  // Realtime: canal privado de conversaciones (la base solo deja suscribirse a dueño y cajero).
  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | undefined;
    const canal = supabase.channel(`negocio:${negocioId}:conversaciones`, { config: { private: true } });
    canal
      .on('broadcast', { event: 'conversacion' }, () => {
        clearTimeout(espera);
        espera = setTimeout(() => void recargar(), ESPERA_AVISOS_MS);
      })
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') void recargar();
      });
    void recargar();
    return () => {
      clearTimeout(espera);
      void supabase.removeChannel(canal);
    };
  }, [negocioId, recargar]);

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void recargar();
    };
    const alVolverRed = () => void recargar();
    const intervalo = setInterval(() => void recargar(), RECARGA_PERIODICA_MS);
    window.addEventListener('online', alVolverRed);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener('online', alVolverRed);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [recargar]);

  return { conversaciones, error, recargar };
}
