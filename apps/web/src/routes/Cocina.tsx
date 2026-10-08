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
import { Agotados } from '../components/Agotados.tsx';
import { ListaAvisos } from '../components/Avisos.tsx';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { Dialogo } from '../components/Dialogo.tsx';
import { Cargando, Vacio } from '../components/Estado.tsx';
import { Icono } from '../components/Icono.tsx';
import { Logo } from '../components/Marca.tsx';
import { TarjetaCocina } from '../components/TarjetaCocina.tsx';
import { useAhora } from '../hooks/useAhora.ts';
import { useAvisos } from '../hooks/useAvisos.ts';
import { useMenu } from '../hooks/useMenu.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { type Conexion, usePedidosCocina } from '../hooks/usePedidosCocina.ts';
import { useWakeLock } from '../hooks/useWakeLock.ts';
import { moverPedido } from '../lib/estados.ts';
import { activarSonido, efecto, sonarCancelado, sonarPedidoNuevo } from '../lib/sonido.ts';

/** Cuánto dura el resaltado de una tarjeta recién llegada. */
const RESALTADO_MS = 8000;
/** El sello de LISTO se ve al menos esto antes de que el ticket se vaya. */
const SELLO_MS = 700;
/** Lo que tarda el ticket en irse. */
const SALIDA_MS = 320;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pantalla de cocina, pensada para una tablet horizontal. Arranca con un toque (el
 * navegador exige un gesto para el sonido y la pantalla completa) y desde ahí se maneja sola.
 * Incrustada (simulador de la demo): ocupa su caja, sin pantalla de inicio ni pantalla completa,
 * y los tickets van uno abajo del otro.
 */
/** `apilada` = tickets uno abajo del otro (columna angosta); si no, en fila como en la tablet. */
export function Cocina({ incrustada = false, apilada = incrustada }: { incrustada?: boolean; apilada?: boolean }) {
  const negocio = useNegocio();
  // En la demo la base deja que el cajero también mueva la cocina: la pantalla lo sigue.
  const rol = negocio.esDemo ? 'dueno' : negocio.rol;
  const config = useMemo(() => leerConfigCocina(negocio.config), [negocio.config]);
  const [iniciada, setIniciada] = useState(incrustada);
  const [conSonido, setConSonido] = useState(false);
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set());
  const [recientes, setRecientes] = useState<ReadonlySet<string>>(new Set());
  const [sellados, setSellados] = useState<ReadonlySet<string>>(new Set());
  const [saliendo, setSaliendo] = useState<ReadonlySet<string>>(new Set());
  const [aConfirmar, setAConfirmar] = useState<PedidoCocina | null>(null);
  const [verAgotados, setVerAgotados] = useState(false);
  const menu = useMenu(negocio.id);
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
      // Incrustada (demo) no hay alarma: ya sonó la impresora en el mostrador al confirmar.
      if (conSonidoRef.current) sonarPedidoNuevo();
      resaltar(nuevos.map((p) => p.id));
    },
    onCancelado: (p) => {
      setCancelados((cs) => [...cs.filter((c) => c.id !== p.id), p]);
      if (conSonidoRef.current) sonarCancelado();
      else efecto('error');
    },
  });
  const wakeLock = useWakeLock(iniciada && !incrustada);
  const ahora = useAhora(desfase);

  const marcar = (set: typeof setOcupados, id: string, si: boolean) =>
    set((o) => {
      const n = new Set(o);
      if (si) n.add(id);
      else n.delete(id);
      return n;
    });

  async function mover(p: PedidoCocina, accion: 'avanzar' | 'retroceder') {
    // Listo: cae el sello enseguida y el ticket se va cuando la base confirma.
    const sellar = accion === 'avanzar' && p.estado === 'en_cocina';
    const inicio = Date.now();
    marcar(setOcupados, p.id, true);
    if (sellar) {
      marcar(setSellados, p.id, true);
      efecto('sello');
    }
    const r = await moverPedido(accion, p.id, p.estado);
    if (sellar && r.ok && r.cambiado) {
      await espera(Math.max(0, SELLO_MS - (Date.now() - inicio)));
      marcar(setSaliendo, p.id, true);
      await espera(SALIDA_MS);
    }
    marcar(setOcupados, p.id, false);
    marcar(setSellados, p.id, false);
    marcar(setSaliendo, p.id, false);
    if (!r.ok) {
      efecto('error');
      return avisar({ tipo: 'error', clave: p.id, texto: r.error });
    }
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
  // Un ticket sellado sigue en el riel hasta que termina de irse, aunque la recarga en tiempo
  // real ya lo traiga como listo.
  const enMano = (p: PedidoCocina) => sellados.has(p.id) || saliendo.has(p.id);
  const enCurso = lista
    .filter((p) => p.estado === 'pendiente' || p.estado === 'en_cocina' || enMano(p))
    .map((p) => (enMano(p) ? { ...p, estado: 'en_cocina' as const } : p));
  const listos = lista.filter((p) => p.estado === 'listo' && !enMano(p));

  return (
    <div className={`${incrustada ? 'relative h-full' : 'fixed inset-0 z-40'} flex flex-col bg-noche text-noche-tinta select-none`}>
      <header className={`flex items-center gap-3 border-b border-noche-linea ${incrustada ? 'px-3.5 py-2.5' : 'px-4 py-3 sm:px-5'}`}>
        {!incrustada && <Logo claro className="size-8" />}
        <div className="min-w-0">
          <p className="rotulo text-noche-tinta-2">Cocina</p>
          {!incrustada && <p className="truncate text-lg font-bold tracking-[-0.015em]">{negocio.nombre}</p>}
        </div>
        <Reloj ahora={ahora} grande={!incrustada} />
        <div className="ml-auto flex items-center gap-1.5">
          <IndicadorConexion conexion={conexion} />
          {iniciada && (
            <button
              type="button"
              onClick={() => {
                void menu.recargar();
                setVerAgotados(true);
              }}
              className="btn btn-noche btn-chico"
            >
              Agotados
            </button>
          )}
          {iniciada && !incrustada && (
            <button
              type="button"
              onClick={() => void activarSonido().then((ok) => (setConSonido(ok), ok && sonarPedidoNuevo()))}
              className={`btn btn-chico ${conSonido ? 'btn-noche' : 'border-alerta bg-alerta text-tinta hover:bg-alerta'}`}
              title="Probar el sonido de pedido nuevo"
            >
              <Icono nombre={conSonido ? 'sonido' : 'silencio'} className="size-4" />
              {conSonido ? 'Sonido' : 'Activar sonido'}
            </button>
          )}
          {incrustada ? null : negocio.rol === 'cocina' ? (
            <BotonSalir conTexto={false} className="btn-noche" />
          ) : (
            <Link to="../mostrador" className="btn btn-noche btn-chico">
              <Icono nombre="volver" className="size-4" />
              Volver
            </Link>
          )}
        </div>
      </header>

      {conexion === 'sin_conexion' && (
        <div role="alert" className="flex animate-entra items-center gap-4 bg-peligro px-5 py-3 font-semibold text-white">
          <span aria-hidden className="size-2 animate-latido rounded-full bg-white" />
          <span>Sin conexión. Los pedidos nuevos pueden no aparecer hasta que vuelva internet.</span>
          <button type="button" onClick={() => void recargar()} className="btn btn-chico ml-auto border-white bg-white text-peligro hover:bg-white/90">
            Reintentar
          </button>
        </div>
      )}
      {!incrustada && iniciada && (wakeLock === 'no_soportado' || wakeLock === 'error') && (
        <p className="bg-alerta px-5 py-2 text-sm font-semibold text-tinta">
          Esta tablet no permite mantener la pantalla encendida desde el navegador: configurala para que no se apague.
        </p>
      )}

      {cancelados.map((p) => (
        <div key={p.id} role="alert" className="flex animate-entra items-center gap-4 bg-peligro px-5 py-3 text-white">
          <span className="num text-2xl font-extrabold">#{p.numero}</span>
          <span className="text-lg font-bold">Cancelado. No lo prepares.</span>
          <button
            type="button"
            onClick={() => setCancelados((cs) => cs.filter((c) => c.id !== p.id))}
            className="btn ml-auto border-white bg-white text-peligro hover:bg-white/90"
          >
            Entendido
          </button>
        </div>
      ))}

      <main className="relative flex min-h-0 flex-1 flex-col">
        {/* La ranura de la impresora: los tickets salen de acá. */}
        <div aria-hidden className="relative z-10 h-3 shrink-0 bg-noche">
          <span className="absolute inset-x-4 bottom-0 h-1 rounded-b-[3px] bg-black/70" />
        </div>
        {pedidos === null ? (
          error ? (
            <p className="m-auto max-w-md p-6 text-center text-lg text-noche-tinta-2">{error}</p>
          ) : (
            <Cargando oscuro />
          )
        ) : enCurso.length === 0 ? (
          <Vacio oscuro icono="ticket" titulo="Sin pedidos por ahora">
            Los nuevos aparecen acá solos{incrustada ? '' : ', con sonido'}.
          </Vacio>
        ) : (
          <section
            aria-label="Pedidos en curso"
            className={`flex min-h-0 flex-1 gap-4 px-4 pb-4 ${apilada ? 'flex-col overflow-y-auto' : 'items-start overflow-x-auto sm:px-5'}`}
          >
            {enCurso.map((p) => {
              const minutos = minutosDesde(p.created_at, ahora);
              return (
                <TarjetaCocina
                  key={p.id}
                  pedido={p}
                  minutos={minutos}
                  color={colorTemporizador(minutos, config)}
                  puedeAvanzar={puedeAvanzar(rol, p.estado)}
                  ocupado={ocupados.has(p.id)}
                  nuevo={recientes.has(p.id)}
                  sellado={sellados.has(p.id)}
                  saliendo={saliendo.has(p.id)}
                  ancho={!apilada}
                  onAvanzar={() => void mover(p, 'avanzar')}
                />
              );
            })}
          </section>
        )}
      </main>

      <footer
        className={`flex gap-3 border-t border-noche-linea bg-noche-2 ${
          apilada ? 'min-h-20 flex-col px-3.5 py-3' : 'min-h-24 items-center gap-4 px-4 py-3 sm:px-5'
        }`}
      >
        <section aria-label="Listos para entregar" className="min-w-0 flex-1">
          <p className="rotulo mb-2 text-noche-ok">Listos para entregar</p>
          {listos.length === 0 ? (
            <p className="text-sm text-noche-tinta-2">Nada por ahora.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto sin-barra">
              {listos.map((p) => {
                const puedeEntregar = puedeAvanzar(rol, p.estado);
                const puedeVolver = puedeRetroceder(rol, p.estado);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={ocupados.has(p.id) || (!puedeEntregar && !puedeVolver)}
                    onClick={() => setAConfirmar(p)}
                    className="flex h-11 shrink-0 animate-burbuja items-baseline gap-2 rounded-lg border border-[#2c5640] bg-[#1f3a2b] px-3 pt-2 text-left transition-colors hover:bg-[#25452f] disabled:opacity-70"
                  >
                    <span className="num text-xl font-extrabold text-[#d7f0df]">#{p.numero}</span>
                    <span className="text-xs font-semibold text-noche-ok">{textoEntrega(p)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <ListaAvisos avisos={avisos} onCerrar={quitar} enLinea />
      </footer>

      {aConfirmar && (
        <Dialogo
          oscuro
          titulo={`Pedido #${aConfirmar.numero}`}
          descripcion={`${textoEntrega(aConfirmar)} · listo para entregar`}
          onCerrar={() => setAConfirmar(null)}
          ancho="max-w-sm"
        >
          <div className="flex flex-col gap-2">
            {puedeAvanzar(rol, aConfirmar.estado) && (
              <button
                type="button"
                data-sonido="sello"
                onClick={() => {
                  const p = aConfirmar;
                  setAConfirmar(null);
                  void mover(p, 'avanzar');
                }}
                className="btn btn-grande w-full border-noche-tinta bg-noche-tinta text-noche hover:bg-white"
              >
                <Icono nombre="check" />
                Entregado
              </button>
            )}
            {puedeRetroceder(rol, aConfirmar.estado) && (
              <button
                type="button"
                onClick={() => {
                  const p = aConfirmar;
                  setAConfirmar(null);
                  void mover(p, 'retroceder');
                }}
                className="btn btn-noche btn-grande w-full"
              >
                <Icono nombre="volver" />
                Volver a cocina
              </button>
            )}
          </div>
        </Dialogo>
      )}

      {verAgotados && (
        <Dialogo
          oscuro
          titulo="Agotados"
          descripcion="Tocá lo que se terminó. Desde ese momento el mostrador ya no lo puede confirmar."
          onCerrar={() => setVerAgotados(false)}
          ancho="max-w-3xl"
        >
          <div className="max-h-[60dvh] overflow-y-auto">
            <Agotados oscuro categorias={menu.categorias} productos={menu.productos} onCambio={() => void menu.recargar()} />
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => setVerAgotados(false)} className="btn btn-grande border-noche-tinta bg-noche-tinta px-8 text-noche hover:bg-white">
              Listo
            </button>
          </div>
        </Dialogo>
      )}
      {!iniciada && <PantallaInicio nombre={negocio.nombre} onEmpezar={() => void empezar()} />}
    </div>
  );
}

function Reloj({ ahora, grande }: { ahora: number; grande: boolean }) {
  return (
    <p className={`num ml-2 font-extrabold ${grande ? 'hidden text-[1.75rem] sm:ml-4 sm:block' : 'text-lg'}`}>
      {new Date(ahora).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
    </p>
  );
}

function IndicadorConexion({ conexion }: { conexion: Conexion }) {
  const estilos: Record<Conexion, [string, string]> = {
    conectando: ['text-noche-tinta-2', 'Conectando'],
    en_linea: ['text-noche-ok', 'En línea'],
    sin_conexion: ['text-peligro', 'Sin conexión'],
  };
  const [clase, texto] = estilos[conexion];
  return (
    <span role="status" className={`num mr-1.5 flex items-center gap-2 text-xs font-semibold ${clase}`}>
      <span aria-hidden className="relative flex size-2">
        {conexion === 'en_linea' && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-40 [animation-duration:2s]" />}
        <span className={`relative size-2 rounded-full bg-current ${conexion === 'conectando' ? 'animate-latido' : ''}`} />
      </span>
      <span className="hidden sm:inline">{texto}</span>
    </span>
  );
}

function PantallaInicio({ nombre, onEmpezar }: { nombre: string; onEmpezar: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex animate-aparece items-center justify-center bg-noche p-6">
      <div className="w-full max-w-md text-center">
        <Logo claro className="mx-auto mb-6 size-14" />
        <p className="rotulo text-noche-tinta-2">Anotado · Cocina</p>
        <h1 className="mt-3 text-4xl font-bold tracking-[-0.03em]">{nombre}</h1>
        <p className="mt-4 text-lg leading-snug text-noche-tinta-2">
          Los pedidos aparecen solos, del más viejo (izquierda) al más nuevo. Suena cuando llega uno.
        </p>
        <button
          type="button"
          onClick={onEmpezar}
          data-sonido="no"
          className="btn btn-birome mt-10 h-20 w-full rounded-2xl text-3xl font-extrabold"
        >
          Empezar
        </button>
        <p className="mt-4 text-sm text-noche-tinta-2">Activa el sonido y mantiene la pantalla encendida.</p>
      </div>
    </div>
  );
}
