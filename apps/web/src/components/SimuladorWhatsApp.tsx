import { telefonoDemo } from '@anotado/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAhora } from '../hooks/useAhora.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { useSesion } from '../hooks/useSesion.ts';
import { mensajeDeFuncion } from '../lib/funciones.ts';
import { supabase } from '../lib/supabase.ts';

/** Sin Realtime propio: el canal de conversaciones ya lo usa el mostrador de al lado. */
const REFRESCO_MS = 4_000;
/** Después de mandar, se mira seguido hasta que contesta el bot. */
const REFRESCO_RAPIDO_MS = 1_200;
const ESPERA_RESPUESTA_MS = 30_000;
const MAX_MENSAJES = 100;

const SUGERENCIAS = [
  'Hola! Quiero 2 completas sin tomate y una coca',
  'La de 1,5',
  'Paso a buscar',
  'Mejor mandámelo a Blandengues 450',
];

type Mensaje = { id: string; rol: 'cliente' | 'asistente' | 'sistema'; contenido: string; created_at: string };

/** Lo que se ve en el teléfono: todas las charlas de este cliente, las últimas al final. Null si falla. */
async function leerMensajes(negocioId: string, userId: string): Promise<Mensaje[] | null> {
  const { data: cliente, error: errCliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('negocio_id', negocioId)
    .eq('telefono', telefonoDemo(userId))
    .maybeSingle();
  if (errCliente) return null;
  if (!cliente) return [];
  const { data: convs, error: errConvs } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('negocio_id', negocioId)
    .eq('cliente_id', cliente.id);
  if (errConvs) return null;
  const ids = convs.map((c) => c.id);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('mensajes')
    .select('id, rol, contenido, created_at')
    .eq('negocio_id', negocioId)
    .in('conversacion_id', ids)
    .order('orden', { ascending: false })
    .limit(MAX_MENSAJES);
  return error ? null : [...data].reverse();
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });

/**
 * El teléfono del cliente en la demo: el visitante escribe como si le escribiera al local por
 * WhatsApp. El mensaje entra por el mismo camino que uno real (Edge Function demo-whatsapp) y
 * acá se ve lo que contesta el bot. Cada visitante es siempre el mismo cliente (telefonoDemo).
 */
export function SimuladorWhatsApp() {
  const negocio = useNegocio();
  const sesion = useSesion();
  const userId = sesion?.user.id;
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const final = useRef<HTMLDivElement>(null);
  const ahora = useAhora(0, 1_000);

  const cargar = useCallback(() => {
    if (!userId) return;
    void leerMensajes(negocio.id, userId).then((m) => {
      if (m) setMensajes(m);
    });
  }, [negocio.id, userId]);

  // El bot todavía no contestó lo último que escribió el cliente (hasta 30 s): se mira seguido.
  const ultimo = mensajes.at(-1);
  const esperando = ultimo?.rol === 'cliente' && ahora - new Date(ultimo.created_at).getTime() < ESPERA_RESPUESTA_MS;

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, esperando ? REFRESCO_RAPIDO_MS : REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargar, esperando]);

  useEffect(() => {
    final.current?.scrollIntoView({ block: 'nearest' });
  }, [mensajes.length, esperando]);

  async function mandar(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    setError(null);
    const { error: errFuncion } = await supabase.functions.invoke('demo-whatsapp', { body: { texto: limpio } });
    setEnviando(false);
    if (errFuncion) return setError(await mensajeDeFuncion(errFuncion, 'No se pudo mandar. Probá de nuevo.'));
    setTexto('');
    cargar();
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    void mandar(texto);
  }

  return (
    <section aria-label="WhatsApp del cliente" className="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-3xl border-8 border-stone-900 bg-[#efe7dd] shadow-xl">
      <header className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-white/20 font-black">
          {negocio.nombre.charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold">{negocio.nombre}</p>
          <p className="text-xs text-white/80">{esperando ? 'escribiendo…' : 'Cuenta de empresa'}</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {mensajes.length === 0 && (
          <p className="m-auto max-w-56 rounded-xl bg-amber-50 p-3 text-center text-sm text-stone-700">
            Sos el cliente: escribile al local como por WhatsApp. Abajo tenés ejemplos.
          </p>
        )}
        {mensajes.map((m) => {
          const propio = m.rol === 'cliente';
          return (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-xl px-3 py-2 shadow-sm ${propio ? 'self-end bg-[#dcf8c6]' : 'self-start bg-white'}`}
            >
              <p className="text-[15px] whitespace-pre-wrap break-words text-stone-900">{m.contenido}</p>
              <p className="text-right text-[11px] text-stone-500">{hora(m.created_at)}</p>
            </div>
          );
        })}
        {esperando && <p className="self-start rounded-xl bg-white px-3 py-2 text-stone-500 shadow-sm">…</p>}
        <div ref={final} />
      </div>

      <div className="flex gap-2 overflow-x-auto px-3 pb-2">
        {SUGERENCIAS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={enviando}
            onClick={() => void mandar(s)}
            className="shrink-0 rounded-full border border-[#075e54]/30 bg-white px-3 py-1 text-sm text-[#075e54] disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p>}
      <form onSubmit={enviar} className="flex gap-2 bg-[#f0f0f0] p-2">
        <input
          aria-label="Mensaje"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={500}
          placeholder="Escribí un mensaje"
          className="min-w-0 flex-1 rounded-full bg-white px-4 py-2"
        />
        <button
          type="submit"
          disabled={enviando || !texto.trim()}
          className="rounded-full bg-[#075e54] px-4 font-bold text-white disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </section>
  );
}
