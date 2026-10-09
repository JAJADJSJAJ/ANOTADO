import { formatearPrecio, telefonoDemo } from '@anotado/shared';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Vacio } from '../components/Estado.tsx';
import { Icono } from '../components/Icono.tsx';
import { SimuladorWhatsApp } from '../components/SimuladorWhatsApp.tsx';
import { TarjetaWhatsApp } from '../components/TarjetaWhatsApp.tsx';
import { type Conversacion, useConversaciones } from '../hooks/useConversaciones.ts';
import { useMenu } from '../hooks/useMenu.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { useSesion } from '../hooks/useSesion.ts';
import { useZonas } from '../hooks/useZonas.ts';
import { efecto } from '../lib/sonido.ts';
import { Cocina } from './Cocina.tsx';

type Paso = 1 | 2 | 3;

const PASOS: { paso: Paso; corto: string; titulo: string; texto: string }[] = [
  {
    paso: 1,
    corto: 'Escribí',
    titulo: 'Sos el cliente',
    texto: 'Escribile al local como por WhatsApp, con tus palabras. Abajo del teléfono tenés ejemplos.',
  },
  {
    paso: 2,
    corto: 'Confirmá',
    titulo: 'Ahora sos el mostrador',
    texto: 'La IA ya armó el pedido con lo que escribiste. Revisalo, elegí cómo se entrega y confirmalo.',
  },
  {
    paso: 3,
    corto: 'Cociná',
    titulo: 'Y ahora la cocina',
    texto: 'El pedido llegó solo. Tocá Empezar y después Listo: al cliente le llega el aviso por WhatsApp.',
  },
];

/**
 * La demo, paso a paso: una pantalla a la vez (el teléfono del cliente, el mostrador, la
 * cocina). Las tres quedan montadas para no perder nada al ir y volver. Solo en locales de demo.
 */
export function Simulador() {
  const negocio = useNegocio();
  const userId = useSesion()?.user.id;
  const [paso, setPaso] = useState<Paso>(1);
  const [confirmado, setConfirmado] = useState<{ numero: number; total: number } | null>(null);

  // La conversación de este visitante (la demo es compartida: las de otros no se muestran).
  const whatsapp = useConversaciones(negocio.id);
  const telefono = userId ? telefonoDemo(userId) : null;
  const mia = whatsapp.conversaciones?.find((c) => c.cliente?.telefono === telefono) ?? null;
  const armado = (mia?.borrador.items.length ?? 0) > 0;

  if (!negocio.esDemo) return <Navigate to="../mostrador" replace />;

  const actual = PASOS[paso - 1]!;
  const ir = (p: Paso) => {
    setPaso(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-linea bg-hoja">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          <Pasos actual={paso} listos={{ 1: armado || !!confirmado, 2: !!confirmado, 3: false }} onIr={ir} />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10">
        <header key={paso} className="mb-8 max-w-xl animate-entra">
          <p className="rotulo text-birome">Paso {paso} de 3</p>
          <h1 className="mt-2 text-[2rem] leading-tight font-bold tracking-[-0.03em]">{actual.titulo}</h1>
          <p className="mt-2 text-lg leading-snug text-tinta-2">{actual.texto}</p>
        </header>

        <div hidden={paso !== 1} className="flex flex-col items-center gap-6">
          <div className="h-[min(38rem,calc(100dvh-20rem))] min-h-[30rem] w-full max-w-sm">
            <SimuladorWhatsApp />
          </div>
          <Navegacion
            siguiente={
              <button
                type="button"
                onClick={() => ir(2)}
                className={`btn btn-grande ${armado ? 'btn-birome' : ''}`}
                data-sonido="llave"
              >
                {armado ? 'Ver el pedido en el mostrador' : 'Siguiente'}
                <Icono nombre="flecha" />
              </button>
            }
            nota={armado ? 'La IA ya armó tu pedido.' : 'Mandá un mensaje para empezar.'}
          />
        </div>

        <div hidden={paso !== 2} className="flex flex-col gap-6">
          <MostradorDemo
            conversacion={mia}
            cargando={!whatsapp.conversaciones}
            confirmado={!!confirmado}
            onRecargar={() => void whatsapp.recargar()}
            onVolver={() => ir(1)}
            onConfirmado={(numero, total) => {
              setConfirmado({ numero, total });
              // Un momento para escuchar la impresora y ver el aviso, y a la cocina.
              setTimeout(() => ir(3), 900);
            }}
          />
          <Navegacion
            anterior={() => ir(1)}
            siguiente={
              <button type="button" onClick={() => ir(3)} className="btn btn-grande" data-sonido="llave">
                Siguiente
                <Icono nombre="flecha" />
              </button>
            }
          />
        </div>

        <div hidden={paso !== 3} className="flex flex-col gap-6">
          {confirmado && (
            <p role="status" className="flex animate-entra items-center gap-2 text-tinta-2">
              <Icono nombre="check" className="text-ok" />
              Tu pedido <span className="num font-bold text-tinta">#{confirmado.numero}</span> quedó confirmado por{' '}
              <span className="num font-semibold text-tinta">{formatearPrecio(confirmado.total)}</span>.
            </p>
          )}
          <div className="h-[34rem] overflow-hidden rounded-2xl shadow-alta">
            <Cocina incrustada apilada={false} />
          </div>
          <Final onOtro={() => ir(1)} />
        </div>

        <p className="mt-auto flex items-center justify-center gap-2 pt-12 text-center text-sm text-tinta-3">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-alerta" />
          Demo compartida: no escribas datos reales. Se borra todo cada noche.
        </p>
      </main>
    </div>
  );
}

/** Los tres pasos arriba: el actual en tinta, los hechos con tilde. Se puede saltar a cualquiera. */
function Pasos({ actual, listos, onIr }: { actual: Paso; listos: Record<Paso, boolean>; onIr: (p: Paso) => void }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {PASOS.map(({ paso, corto }, i) => {
        const esActual = paso === actual;
        const hecho = listos[paso] && !esActual;
        return (
          <li key={paso} className="flex flex-1 items-center gap-2 sm:gap-3 last:flex-none">
            <button
              type="button"
              onClick={() => onIr(paso)}
              aria-current={esActual ? 'step' : undefined}
              data-sonido="llave"
              className="group flex items-center gap-2.5 rounded-full py-1 pr-2"
            >
              <span
                className={`num grid size-8 shrink-0 place-items-center rounded-full border text-sm font-bold transition-colors duration-300 ${
                  esActual
                    ? 'border-tinta bg-tinta text-white'
                    : hecho
                      ? 'border-ok bg-ok-suave text-ok'
                      : 'border-linea-fuerte bg-hoja text-tinta-3 group-hover:border-tinta-3'
                }`}
              >
                {hecho ? <Icono nombre="check" className="size-4" /> : paso}
              </span>
              <span className={`text-sm font-semibold transition-colors ${esActual ? 'text-tinta' : 'text-tinta-3 group-hover:text-tinta-2'} max-sm:sr-only`}>
                {corto}
              </span>
            </button>
            {i < PASOS.length - 1 && (
              <span aria-hidden className="relative h-px flex-1 overflow-hidden bg-linea">
                <span
                  className={`absolute inset-y-0 left-0 bg-tinta transition-[width] duration-500 ease-salida ${actual > paso ? 'w-full' : 'w-0'}`}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Navegacion({ anterior, siguiente, nota }: { anterior?: () => void; siguiente: ReactNode; nota?: string }) {
  return (
    <div className="flex w-full items-center gap-3">
      {anterior && (
        <button type="button" onClick={anterior} className="btn btn-fantasma btn-grande" data-sonido="llave">
          <Icono nombre="volver" />
          Anterior
        </button>
      )}
      {nota && <p className="text-sm text-tinta-3">{nota}</p>}
      <div className="ml-auto">{siguiente}</div>
    </div>
  );
}

/** El mostrador de la demo: solo la conversación de este visitante, sin pestañas ni listas. */
function MostradorDemo({
  conversacion,
  cargando,
  confirmado,
  onRecargar,
  onVolver,
  onConfirmado,
}: {
  conversacion: Conversacion | null;
  cargando: boolean;
  /** Ya se confirmó un pedido en esta visita (la conversación se cerró). */
  confirmado: boolean;
  onRecargar: () => void;
  onVolver: () => void;
  onConfirmado: (numero: number, total: number) => void;
}) {
  const negocio = useNegocio();
  const menu = useMenu(negocio.id);
  const productos = useMemo(() => new Map(menu.productos.map((p) => [p.id, p])), [menu.productos]);
  const activos = useMemo(() => menu.productos.filter((p) => p.activo), [menu.productos]);
  const { zonas } = useZonas(negocio.id);
  const zonasActivas = useMemo(() => zonas.filter((z) => z.activa), [zonas]);

  if (cargando || menu.cargando) return <div className="tarjeta min-h-80" />;
  if (!conversacion) {
    return (
      <div className="tarjeta flex min-h-80 flex-col items-center justify-center">
        {confirmado ? (
          <Vacio icono="check" titulo="Pedido confirmado">
            Ya está en la cocina. Si escribís de nuevo desde el teléfono, aparece acá otra vez.
          </Vacio>
        ) : (
          <Vacio icono="mensaje" titulo="Todavía no hay ningún pedido tuyo">
            Primero escribile al local desde el teléfono del cliente.
          </Vacio>
        )}
        <button type="button" onClick={onVolver} className="btn mb-8">
          <Icono nombre="volver" />
          Ir al teléfono
        </button>
      </div>
    );
  }
  return (
    <TarjetaWhatsApp
      key={conversacion.id}
      negocioId={negocio.id}
      servidor={conversacion}
      productos={productos}
      activos={activos}
      categorias={menu.categorias}
      zonas={zonasActivas}
      onRecargar={onRecargar}
      onCreada={() => {}}
      onCerrada={(pedido) => {
        onRecargar();
        if (pedido) {
          efecto('imprimir');
          onConfirmado(pedido.numero, pedido.total_centavos);
        }
      }}
    />
  );
}

/** Al final: volver a empezar o mirar el local completo, ahora que ya se entiende. */
function Final({ onOtro }: { onOtro: () => void }) {
  return (
    <section className="mt-4 flex flex-col gap-5 border-t border-linea pt-8 sm:flex-row sm:items-center">
      <div className="flex-1">
        <h2 className="text-xl font-bold tracking-[-0.015em]">Eso es Anotado</h2>
        <p className="mt-1 text-tinta-2">
          Cuando lo marcás listo, al cliente le llega el aviso. Miralo en el teléfono o recorré el local completo, como lo usaría
          un negocio.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onOtro} className="btn btn-grande" data-sonido="llave">
          <Icono nombre="volver" />
          Volver al teléfono
        </button>
        <Link to="../mostrador" className="btn btn-tinta btn-grande">
          Ver el local completo
          <Icono nombre="flecha" />
        </Link>
      </div>
    </section>
  );
}
