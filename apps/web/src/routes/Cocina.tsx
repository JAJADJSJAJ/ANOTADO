import {
  colorTemporizador,
  ETIQUETA_ESTADO,
  leerConfigCocina,
  minutosDesde,
  type PedidoCocina,
  puedeAvanzar,
  puedeRetroceder,
  textoEntrega,
} from '@anotado/shared';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ListaAvisos } from '../components/Avisos.tsx';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { Cargando } from '../components/Estado.tsx';
import { TarjetaCocina } from '../components/TarjetaCocina.tsx';
import { useAhora } from '../hooks/useAhora.ts';
import { useAvisos } from '../hooks/useAvisos.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { type Conexion, usePedidosCocina } from '../hooks/usePedidosCocina.ts';
import { useWakeLock } from '../hooks/useWakeLock.ts';
import { moverPedido } from '../lib/estados.ts';
import { activarSonido, sonarCancelado, sonarPedidoNuevo } from '../lib/sonido.ts';

/** Cuánto dura el resaltado de una tarjeta recién llegada. */
const RESALTADO_MS = 8000;

/**
 * Pantalla de cocina, pensada para una tablet horizontal. Arranca con un toque (el
 * navegador exige un gesto para el sonido y la pantalla completa) y desde ahí se maneja sola.
 */
export function Cocina() {
  const negocio = useNegocio();
  const config = useMemo(() => leerConfigCocina(negocio.config), [negocio.config]);
  const [iniciada, setIniciada] = useState(false);
  const [conSonido, setConSonido] = useState(false);
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set());
  const [recientes, setRecientes] = useState<ReadonlySet<string>>(new Set());
  const [aConfirmar, setAConfirmar] = useState<PedidoCocina | null>(null);
  // Cancelados: quedan arriba hasta que alguien toca "Entendido" (que no se cocine de más).
  const [cancelados, setCancelados] = useState<PedidoCocina[]>([]);
  const { avisos, avisar, quitar } = useAvisos();
  const conSonidoRef = useRef(conSonido);
  useLayoutEffect(() => {
    conSonidoRef.current = conSonido;
  });

  const resaltar = useCallback((ids: string[]) => {
    setRecientes((r) => new Set([...r, ...ids]));
    setTimeout(() => setRecientes((r) => new Set([...r].filter((id) => !ids.includes(id)))), RESALTADO_MS);
  }, []);

  const { pedidos, desfase, conexion, error, recargar, actualizarLocal } = usePedidosCocina(negocio.id, {
    onNuevos: (nuevos) => {
      if (conSonidoRef.current) sonarPedidoNuevo();
      resaltar(nuevos.map((p) => p.id));
    },
    onCancelado: (p) => {
      setCancelados((cs) => [...cs.filter((c) => c.id !== p.id), p]);
      if (conSonidoRef.current) sonarCancelado();
    },
  });
  const wakeLock = useWakeLock(iniciada);
  const ahora = useAhora(desfase);

  const marcarOcupado = (id: string, si: boolean) =>
    setOcupados((o) => {
      const n = new Set(o);
      if (si) n.add(id);
      else n.delete(id);
      return n;
    });

  async function mover(p: PedidoCocina, accion: 'avanzar' | 'retroceder') {
    marcarOcupado(p.id, true);
    const r = await moverPedido(accion, p.id, p.estado);
    marcarOcupado(p.id, false);
    if (!r.ok) return avisar({ tipo: 'error', clave: p.id, texto: r.error });
    actualizarLocal(p.id, { estado: r.estado });
    if (!r.cambiado) {
      avisar({ tipo: 'info', clave: p.id, texto: `El #${p.numero} ya estaba en "${ETIQUETA_ESTADO[r.estado]}".` });
    } else if (accion === 'avanzar') {
      avisar({
        tipo: 'deshacer',
        clave: p.id,
        texto: `#${p.numero} → ${ETIQUETA_ESTADO[r.estado]}`,
        deshacer: () => void mover({ ...p, estado: r.estado }, 'retroceder'),
      });
    }
    void recargar();
  }

  async function empezar() {
    setConSonido(await activarSonido());
    // Pantalla completa: en una tablet esconde la barra del navegador. Si no se puede, sigue igual.
    await document.documentElement.requestFullscreen?.().catch(() => undefined);
    setIniciada(true);
    sonarPedidoNuevo();
  }

  const lista = pedidos ?? [];
  const enCurso = lista.filter((p) => p.estado === 'pendiente' || p.estado === 'en_cocina');
  const listos = lista.filter((p) => p.estado === 'listo');

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-stone-950 text-white select-none">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-widest text-indigo-300 uppercase">Cocina</p>
          <p className="truncate text-xl font-black">{negocio.nombre}</p>
        </div>
        <Reloj ahora={ahora} />
        <div className="ml-auto flex items-center gap-2">
          <IndicadorConexion conexion={conexion} />
          {iniciada && (
            <button
              type="button"
              onClick={() => void activarSonido().then((ok) => (setConSonido(ok), ok && sonarPedidoNuevo()))}
              className={`rounded-full px-3 py-2 text-sm font-bold ${conSonido ? 'bg-white/10' : 'bg-amber-400 text-stone-950'}`}
              title="Probar sonido"
            >
              {conSonido ? '🔔 Sonido' : '🔕 Activar sonido'}
            </button>
          )}
          {negocio.rol === 'cocina' ? (
            <BotonSalir className="text-stone-300" />
          ) : (
            <Link to="../mostrador" className="rounded-lg px-3 py-2 font-medium text-stone-300 underline">
              Volver
            </Link>
          )}
        </div>
      </header>

      {conexion === 'sin_conexion' && (
        <div role="alert" className="flex items-center gap-4 bg-red-600 px-4 py-3 text-lg font-bold">
          <span className="animate-pulse">●</span>
          <span>Sin conexión. Los pedidos nuevos pueden no aparecer hasta que vuelva internet.</span>
          <button type="button" onClick={() => void recargar()} className="ml-auto rounded-xl bg-white px-4 py-2 text-red-700">
            Reintentar
          </button>
        </div>
      )}
      {iniciada && (wakeLock === 'no_soportado' || wakeLock === 'error') && (
        <p className="bg-amber-400 px-4 py-2 font-bold text-stone-950">
          Esta tablet no permite mantener la pantalla encendida desde el navegador: configurala para que no se apague.
        </p>
      )}

      {cancelados.map((p) => (
        <div key={p.id} role="alert" className="flex items-center gap-4 bg-red-600 px-4 py-3 text-2xl font-black">
          <span>Pedido #{p.numero} cancelado. No lo prepares.</span>
          <button
            type="button"
            onClick={() => setCancelados((cs) => cs.filter((c) => c.id !== p.id))}
            className="ml-auto rounded-xl bg-white px-5 py-2 text-lg text-red-700"
          >
            Entendido
          </button>
        </div>
      ))}

      <main className="flex min-h-0 flex-1 flex-col">
        {pedidos === null ? (
          error ? (
            <p className="m-auto max-w-md text-center text-xl text-red-300">{error}</p>
          ) : (
            <Cargando />
          )
        ) : enCurso.length === 0 ? (
          <div className="m-auto text-center">
            <p className="text-4xl font-black">Sin pedidos por ahora</p>
            <p className="mt-2 text-xl text-stone-400">Los nuevos aparecen acá solos, con sonido.</p>
          </div>
        ) : (
          <section aria-label="Pedidos en curso" className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
            {enCurso.map((p) => {
              const minutos = minutosDesde(p.created_at, ahora);
              return (
                <TarjetaCocina
                  key={p.id}
                  pedido={p}
                  minutos={minutos}
                  color={colorTemporizador(minutos, config)}
                  puedeAvanzar={puedeAvanzar(negocio.rol, p.estado)}
                  ocupado={ocupados.has(p.id)}
                  nuevo={recientes.has(p.id)}
                  onAvanzar={() => void mover(p, 'avanzar')}
                />
              );
            })}
          </section>
        )}

      </main>

      <footer className="flex min-h-24 items-center gap-4 border-t border-white/10 bg-stone-900 px-4 py-3">
        <section aria-label="Listos para entregar" className="min-w-0 flex-1">
          <p className="mb-1 text-sm font-bold tracking-widest text-emerald-300 uppercase">Listos para entregar</p>
          {listos.length === 0 ? (
            <p className="text-stone-500">Nada por ahora.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto">
              {listos.map((p) => {
                const puedeEntregar = puedeAvanzar(negocio.rol, p.estado);
                const puedeVolver = puedeRetroceder(negocio.rol, p.estado);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={ocupados.has(p.id) || (!puedeEntregar && !puedeVolver)}
                    onClick={() => setAConfirmar(p)}
                    className="flex shrink-0 items-baseline gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-left active:bg-emerald-700 disabled:opacity-80"
                  >
                    <span className="text-3xl font-black">#{p.numero}</span>
                    <span className="font-semibold text-emerald-50">{textoEntrega(p)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <ListaAvisos avisos={avisos} onCerrar={quitar} enLinea />
      </footer>

      {aConfirmar && (
        <ConfirmarListo
          pedido={aConfirmar}
          puedeEntregar={puedeAvanzar(negocio.rol, aConfirmar.estado)}
          puedeVolver={puedeRetroceder(negocio.rol, aConfirmar.estado)}
          onCerrar={() => setAConfirmar(null)}
          onElegir={(accion) => {
            const p = aConfirmar;
            setAConfirmar(null);
            void mover(p, accion);
          }}
        />
      )}

      {!iniciada && <PantallaInicio nombre={negocio.nombre} onEmpezar={() => void empezar()} />}
    </div>
  );
}

function Reloj({ ahora }: { ahora: number }) {
  return (
    <p className="ml-4 hidden text-3xl font-black tabular-nums sm:block">
      {new Date(ahora).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
    </p>
  );
}

function IndicadorConexion({ conexion }: { conexion: Conexion }) {
  const estilos: Record<Conexion, [string, string]> = {
    conectando: ['bg-white/10 text-stone-300', 'Conectando…'],
    en_linea: ['bg-emerald-500/15 text-emerald-300', 'En línea'],
    sin_conexion: ['bg-red-600 text-white', 'Sin conexión'],
  };
  const [clase, texto] = estilos[conexion];
  return (
    <span role="status" className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold ${clase}`}>
      <span aria-hidden className="size-2.5 rounded-full bg-current" />
      {texto}
    </span>
  );
}

function PantallaInicio({ nombre, onEmpezar }: { nombre: string; onEmpezar: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-stone-950/95 p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-bold tracking-widest text-indigo-300 uppercase">Anotado · Cocina</p>
        <h1 className="mt-2 text-4xl font-black">{nombre}</h1>
        <p className="mt-4 text-lg text-stone-300">
          Los pedidos aparecen solos, del más viejo (izquierda) al más nuevo. Suena cuando llega uno.
        </p>
        <button
          type="button"
          onClick={onEmpezar}
          className="mt-8 w-full rounded-3xl bg-indigo-500 py-6 text-3xl font-black shadow-2xl shadow-indigo-500/30 active:bg-indigo-600"
        >
          Empezar
        </button>
        <p className="mt-3 text-sm text-stone-400">Activa el sonido y mantiene la pantalla encendida.</p>
      </div>
    </div>
  );
}

function ConfirmarListo({
  pedido,
  puedeEntregar,
  puedeVolver,
  onCerrar,
  onElegir,
}: {
  pedido: PedidoCocina;
  puedeEntregar: boolean;
  puedeVolver: boolean;
  onCerrar: () => void;
  onElegir: (accion: 'avanzar' | 'retroceder') => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={`Pedido ${pedido.numero}`} className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onCerrar}>
      <div className="w-full max-w-sm rounded-3xl bg-stone-50 p-6 text-stone-900" onClick={(e) => e.stopPropagation()}>
        <p className="text-5xl font-black">#{pedido.numero}</p>
        <p className="mt-1 text-lg text-stone-600">{textoEntrega(pedido)} · listo para entregar</p>
        <div className="mt-6 flex flex-col gap-3">
          {puedeEntregar && (
            <button type="button" onClick={() => onElegir('avanzar')} className="rounded-2xl bg-indigo-600 py-4 text-2xl font-black text-white">
              Entregado
            </button>
          )}
          {puedeVolver && (
            <button type="button" onClick={() => onElegir('retroceder')} className="rounded-2xl bg-sky-600 py-4 text-2xl font-black text-white">
              Volver a cocina
            </button>
          )}
          <button type="button" onClick={onCerrar} className="rounded-2xl py-3 text-lg font-bold text-stone-600">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
