import {
  AvisoPedidoSchema,
  desfaseReloj,
  ordenarPedidos,
  type PedidoCocina,
  pedidosNuevos,
  RespuestaCocinaSchema,
} from '@anotado/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.ts';

/** Red de seguridad: aunque Realtime muera callado (tablet dormida), cada 30 s se recarga. */
const RECARGA_PERIODICA_MS = 30_000;
/** Varios avisos seguidos (p. ej. un pedido que se confirma y se mueve) → una sola recarga. */
const ESPERA_AVISOS_MS = 250;

export type Conexion = 'conectando' | 'en_linea' | 'sin_conexion';

type Opciones = {
  /** Pendientes que no estaban en la carga anterior (no se llama en la primera carga). */
  onNuevos?: (pedidos: PedidoCocina[]) => void;
  /** Un pedido de la lista se canceló desde el mostrador. */
  onCancelado?: (pedido: PedidoCocina) => void;
};

/**
 * Pedidos activos del negocio, siempre al día.
 *
 * La lista SIEMPRE sale de pedidos_cocina: los avisos de Realtime solo dicen "algo cambió".
 * Así un aviso perdido nunca deja la pantalla mal: se recarga todo al suscribirse (también
 * al reconectar), al volver internet, al volver a la pestaña y cada 30 s.
 */
export function usePedidosCocina(negocioId: string, opciones: Opciones = {}) {
  const [pedidos, setPedidos] = useState<PedidoCocina[] | null>(null);
  const [desfase, setDesfase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [canalOk, setCanalOk] = useState(false);
  const [cargaOk, setCargaOk] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [cargado, setCargado] = useState(false);

  // Las callbacks más recientes, sin volver a suscribirse al canal cada render.
  const opcionesRef = useRef(opciones);
  useLayoutEffect(() => {
    opcionesRef.current = opciones;
  });
  const pedidosRef = useRef<PedidoCocina[] | null>(null);
  // Una carga a la vez; si piden otra mientras tanto, se hace una más al terminar.
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
        const inicio = Date.now();
        const { data, error } = await supabase.rpc('pedidos_cocina', { p_negocio_id: negocioId });
        const fin = Date.now();
        const r = RespuestaCocinaSchema.safeParse(data);
        if (error || !r.success) {
          setCargaOk(false);
          setError(error ? error.message : 'Respuesta inesperada del servidor');
          continue;
        }
        const lista = ordenarPedidos(r.data.pedidos);
        const anteriores = pedidosRef.current;
        pedidosRef.current = lista;
        setPedidos(lista);
        setDesfase(desfaseReloj(r.data.ahora, inicio, fin));
        setCargaOk(true);
        setError(null);
        setCargado(true);
        if (anteriores) {
          const nuevos = pedidosNuevos(anteriores, lista);
          if (nuevos.length > 0) opcionesRef.current.onNuevos?.(nuevos);
        }
      } while (otraPendiente.current);
    } finally {
      cargando.current = false;
    }
  }, [negocioId]);

  /** Cambia un pedido en pantalla sin esperar la recarga (después de una RPC exitosa). */
  const actualizarLocal = useCallback((id: string, cambios: Partial<PedidoCocina>) => {
    const lista = (pedidosRef.current ?? []).map((p) => (p.id === id ? { ...p, ...cambios } : p));
    pedidosRef.current = lista;
    setPedidos(lista);
  }, []);

  // Realtime: canal privado del negocio. Solo sus miembros pueden suscribirse (policy en la base).
  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | undefined;
    const programar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => void recargar(), ESPERA_AVISOS_MS);
    };

    const canal = supabase.channel(`negocio:${negocioId}:pedidos`, { config: { private: true } });
    canal
      .on('broadcast', { event: 'pedido' }, ({ payload }) => {
        const aviso = AvisoPedidoSchema.safeParse(payload);
        const pedido = aviso.success ? pedidosRef.current?.find((p) => p.id === aviso.data.pedido_id) : undefined;
        if (aviso.success && pedido) {
          // El estado del aviso se aplica ya (un cancelado sale de pantalla al instante);
          // la recarga completa llega enseguida.
          if (aviso.data.estado === 'cancelado') opcionesRef.current.onCancelado?.(pedido);
          actualizarLocal(pedido.id, { estado: aviso.data.estado });
        }
        programar();
      })
      .subscribe((estado) => {
        // SUBSCRIBED llega también después de cada reconexión: ahí se recarga todo.
        if (estado === 'SUBSCRIBED') {
          setCanalOk(true);
          void recargar();
        } else {
          setCanalOk(false);
        }
      });

    void recargar();

    return () => {
      clearTimeout(espera);
      void supabase.removeChannel(canal);
    };
  }, [negocioId, recargar, actualizarLocal]);

  // Red y pestaña.
  useEffect(() => {
    const alVolverRed = () => {
      setOnline(true);
      void recargar();
    };
    const alPerderRed = () => setOnline(false);
    const alVolverPestana = () => {
      if (document.visibilityState === 'visible') void recargar();
    };
    const intervalo = setInterval(() => void recargar(), RECARGA_PERIODICA_MS);
    window.addEventListener('online', alVolverRed);
    window.addEventListener('offline', alPerderRed);
    document.addEventListener('visibilitychange', alVolverPestana);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener('online', alVolverRed);
      window.removeEventListener('offline', alPerderRed);
      document.removeEventListener('visibilitychange', alVolverPestana);
    };
  }, [recargar]);

  const conexion: Conexion = !cargado && cargaOk ? 'conectando' : online && canalOk && cargaOk ? 'en_linea' : 'sin_conexion';

  return { pedidos, desfase, error, conexion, recargar, actualizarLocal };
}
