import { telefonoDemo } from '@anotado/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAhora } from '../hooks/useAhora.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { useSesion } from '../hooks/useSesion.ts';
import { mensajeDeFuncion } from '../lib/funciones.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { Icono } from './Icono.tsx';

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

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

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
  // Lo que se está mandando: se ve enseguida, con el relojito, hasta que llega de la base.
  const [saliendo, setSaliendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const charla = useRef<HTMLDivElement>(null);
  const ahora = useAhora(0, 1_000);

  const cargar = useCallback(
    () =>
      userId
        ? leerMensajes(negocio.id, userId).then((m) => {
            if (m) setMensajes(m);
          })
        : Promise.resolve(),
    [negocio.id, userId],
  );

  // El bot todavía no contestó lo último que escribió el cliente (hasta 30 s): se mira seguido.
  const ultimo = mensajes.at(-1);
  const esperando = ultimo?.rol === 'cliente' && ahora - new Date(ultimo.created_at).getTime() < ESPERA_RESPUESTA_MS;

  useEffect(() => {
    void cargar();
    const intervalo = setInterval(() => void cargar(), esperando ? REFRESCO_RAPIDO_MS : REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargar, esperando]);

  // Respuesta nueva del bot: suena como un mensaje que llega (no al abrir la pantalla).
  const ultimaRespuesta = mensajes.filter((m) => m.rol !== 'cliente').at(-1)?.id;
  const vista = useRef<string | undefined>(undefined);
  const cargado = useRef(false);
  useEffect(() => {
    if (cargado.current && ultimaRespuesta && ultimaRespuesta !== vista.current) efecto('recibir');
    vista.current = ultimaRespuesta;
    if (mensajes.length > 0) cargado.current = true;
  }, [ultimaRespuesta, mensajes.length]);

  useEffect(() => {
    const el = charla.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [mensajes.length, esperando, saliendo]);

  async function mandar(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || saliendo) return;
    setSaliendo(limpio);
    setTexto('');
    setError(null);
    efecto('enviar');
    cargado.current = true;
    const { error: errFuncion } = await supabase.functions.invoke('demo-whatsapp', { body: { texto: limpio } });
    if (errFuncion) {
      setSaliendo(null);
      setTexto(limpio);
      efecto('error');
      return setError(await mensajeDeFuncion(errFuncion, 'No se pudo mandar. Probá de nuevo.'));
    }
    await cargar();
    setSaliendo(null);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    void mandar(texto);
  }

  return (
    <section
      aria-label="WhatsApp del cliente"
      className="flex h-full min-h-[34rem] flex-col overflow-hidden rounded-[22px] border border-linea-fuerte bg-wa-fondo shadow-papel"
    >
      <header className="flex items-center gap-3 bg-wa px-4 py-3 text-white">
        <span aria-hidden className="grid size-9 place-items-center rounded-full bg-white/90 font-bold text-wa">
          {negocio.nombre.charAt(0)}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-semibold">{negocio.nombre}</p>
          <p key={String(esperando)} className="animate-aparece text-xs text-white/75">
            {esperando ? 'escribiendo…' : 'Cuenta de empresa'}
          </p>
        </div>
      </header>

      <div ref={charla} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-4">
        {mensajes.length === 0 && !saliendo && (
          <p className="m-auto max-w-60 rounded-lg bg-[#fff8dc] px-3 py-2.5 text-center text-[0.8125rem] leading-snug text-tinta-2 shadow-[0_1px_0_rgb(0_0_0/0.06)]">
            Escribí tu pedido o tocá un ejemplo de abajo.
          </p>
        )}
        {mensajes.map((m) => (
          <Burbuja key={m.id} propia={m.rol === 'cliente'} texto={m.contenido} hora={hora(m.created_at)} />
        ))}
        {saliendo && <Burbuja propia texto={saliendo} hora={null} />}
        {esperando && !saliendo && (
          <div aria-label="El local está escribiendo" className="flex animate-burbuja gap-1 self-start rounded-[10px] rounded-tl-[3px] bg-white px-3 py-3 shadow-[0_1px_0_rgb(0_0_0/0.08)]">
            {[0, 150, 300].map((d) => (
              <span key={d} className="size-1.5 animate-latido rounded-full bg-[#9aa39b]" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-2.5 pb-2 sin-barra">
        {SUGERENCIAS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={!!saliendo}
            data-sonido="no"
            onClick={() => void mandar(s)}
            className="shrink-0 rounded-full border border-wa/25 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-wa transition-[background-color,transform] duration-150 hover:bg-[#f4faf7] active:scale-95 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mx-2.5 mb-2 rounded-lg bg-peligro-suave px-3 py-2 text-[0.8125rem] font-medium text-peligro">
          {error}
        </p>
      )}
      <form onSubmit={enviar} className="flex gap-2 bg-[#f3f1ed] p-2">
        <input
          aria-label="Mensaje"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={500}
          placeholder="Escribí un mensaje"
          className="h-10 min-w-0 flex-1 rounded-full bg-white px-4 text-[0.9375rem] outline-none focus:shadow-[0_0_0_2px_var(--color-wa)]"
        />
        <button
          type="submit"
          aria-label="Enviar"
          disabled={!!saliendo || !texto.trim()}
          data-sonido="no"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-wa text-white transition-[transform,opacity] duration-150 active:scale-90 disabled:opacity-40"
        >
          <Icono nombre="enviar" />
        </button>
      </form>
    </section>
  );
}

function Burbuja({ propia, texto, hora: h }: { propia: boolean; texto: string; hora: string | null }) {
  return (
    <div
      className={`max-w-[84%] animate-burbuja rounded-[10px] px-2.5 pt-1.5 pb-1 text-[0.9375rem] leading-snug text-tinta shadow-[0_1px_0_rgb(0_0_0/0.08)] ${
        propia ? 'origin-bottom-right self-end rounded-tr-[3px] bg-wa-propio' : 'origin-bottom-left self-start rounded-tl-[3px] bg-white'
      }`}
    >
      <p className="break-words whitespace-pre-wrap">{texto}</p>
      <p className="num mt-0.5 flex items-center justify-end gap-1 text-[0.6875rem] text-[#6f7a70]">
        {h ?? (
          <>
            <Icono nombre="reloj" className="size-3" />
            enviando
          </>
        )}
      </p>
    </div>
  );
}
