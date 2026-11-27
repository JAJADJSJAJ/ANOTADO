import type { CSSProperties, ReactNode } from 'react';

/*
 * Esqueletos de carga con la forma real de cada pantalla: mientras llega el dato se ve el
 * contorno de lo que va a aparecer. Las piezas usan .esqueleto (index.css): gris papel con un
 * brillo diagonal que pasa; con menos movimiento queda en color plano.
 */

type Pieza = { className?: string; style?: CSSProperties; retraso?: number; noche?: boolean };

function clase(base: string, { className = '', noche }: Pieza) {
  return `esqueleto ${noche ? 'esqueleto-noche' : ''} ${base} ${className}`;
}
function estilo({ style, retraso }: Pieza): CSSProperties | undefined {
  return retraso ? { animationDelay: `${retraso}ms`, ...style } : style;
}

/** Renglón de texto. */
export function Linea(p: Pieza) {
  return <span aria-hidden className={clase('h-3 w-full rounded-full', p)} style={estilo(p)} />;
}
/** Bloque rectangular (botón, imagen, tarjeta). */
export function Bloque(p: Pieza) {
  return <span aria-hidden className={clase('h-10 w-full rounded-lg', p)} style={estilo(p)} />;
}
/** Círculo (avatar, punto de estado). */
export function Circulo(p: Pieza) {
  return <span aria-hidden className={clase('size-9 shrink-0 rounded-full', p)} style={estilo(p)} />;
}

/** Contenedor accesible de todo esqueleto. */
function Esqueleto({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-label="Cargando" aria-busy="true" className={`animate-aparece ${className}`}>
      {children}
    </div>
  );
}

const PASO = 70;
const rango = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Pantalla genérica (sesión, invitación): un título y un par de tarjetas. */
export function EsqueletoPagina() {
  return (
    <Esqueleto className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-6">
      <Linea className="h-6 w-1/2" />
      <Linea className="w-3/4" retraso={PASO} />
      {rango(2).map((i) => (
        <div key={i} className="tarjeta flex flex-col gap-3 p-5">
          <Linea className="w-1/3" retraso={(i + 2) * PASO} />
          <Bloque retraso={(i + 3) * PASO} />
        </div>
      ))}
    </Esqueleto>
  );
}

/** Inicio: lista de locales del usuario. */
export function EsqueletoLocales() {
  return (
    <Esqueleto className="mx-auto flex w-full max-w-md flex-col gap-3 p-6 pt-16">
      <Linea className="mb-3 h-7 w-2/5" />
      {rango(3).map((i) => (
        <div key={i} className="tarjeta flex items-center gap-4 p-4">
          <Circulo className="size-11 rounded-xl" retraso={i * PASO} />
          <div className="flex flex-1 flex-col gap-2">
            <Linea className="h-4 w-2/3" retraso={i * PASO + 30} />
            <Linea className="w-1/3" retraso={i * PASO + 60} />
          </div>
        </div>
      ))}
    </Esqueleto>
  );
}

/** Una comanda vacía con su zigzag. */
function TicketVacio({ i, ancho = true }: { i: number; ancho?: boolean }) {
  const r = i * PASO;
  return (
    <div className={`papel-3d shrink-0 ${ancho ? 'w-[19rem] sm:w-[20.5rem]' : 'w-full'}`}>
      <div className="ticket flex flex-col gap-3 border-t-4 border-t-linea-fuerte px-5 pt-4">
        <div className="flex justify-between">
          <Bloque className="h-11 w-24" retraso={r} />
          <Bloque className="h-7 w-16 rounded-md" retraso={r + 30} />
        </div>
        <Linea className="w-2/5" retraso={r + 60} />
        <hr className="border-t border-dashed border-linea-fuerte" />
        {rango(3 - (i % 2)).map((k) => (
          <Linea key={k} className="h-5" style={{ width: `${80 - k * 15}%` }} retraso={r + 90 + k * 30} />
        ))}
        <Bloque className="mt-2 h-16" retraso={r + 200} />
      </div>
    </div>
  );
}

/** Cocina: riel de comandas (o columna apilada en pantallas angostas). */
export function EsqueletoCocina({ apilada = false }: { apilada?: boolean }) {
  return (
    <Esqueleto className={`flex min-h-0 flex-1 gap-4 overflow-hidden px-4 pb-4 ${apilada ? 'flex-col' : 'items-start sm:px-5'}`}>
      {rango(apilada ? 2 : 4).map((i) => (
        <TicketVacio key={i} i={i} ancho={!apilada} />
      ))}
    </Esqueleto>
  );
}

/** Catálogo del mostrador: grilla de productos. */
export function EsqueletoCatalogo({ cantidad = 9 }: { cantidad?: number }) {
  return (
    <Esqueleto className="flex flex-col gap-3">
      <div className="flex gap-2">
        {rango(4).map((i) => (
          <Bloque key={i} className="h-9 w-20 rounded-full" retraso={i * 40} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rango(cantidad).map((i) => (
          <div key={i} className="flex min-h-[5.5rem] flex-col justify-between rounded-xl border border-linea bg-hoja p-3">
            <Linea className="w-3/4" retraso={i * 40} />
            <Linea className="w-1/3" retraso={i * 40 + 30} />
          </div>
        ))}
      </div>
    </Esqueleto>
  );
}

/** Tarjeta del pedido en armado (columna derecha del mostrador). */
export function EsqueletoTarjetaPedido() {
  return (
    <div className="tarjeta flex flex-col gap-3 p-5">
      <Linea className="h-5 w-1/3" />
      {rango(3).map((i) => (
        <div key={i} className="flex justify-between gap-4">
          <Linea className="w-1/2" retraso={(i + 1) * PASO} />
          <Linea className="w-14" retraso={(i + 1) * PASO + 30} />
        </div>
      ))}
      <hr className="border-dashed border-linea-fuerte" />
      <Bloque className="h-12" retraso={350} />
    </div>
  );
}

/** Mostrador: bandeja/catálogo a la izquierda + tarjeta del pedido a la derecha. */
export function EsqueletoMostrador() {
  return (
    <Esqueleto className="grid flex-1 gap-5 p-4 sm:p-6 lg:grid-cols-[1fr_22rem]">
      <EsqueletoCatalogo />
      <EsqueletoTarjetaPedido />
    </Esqueleto>
  );
}

/** Una conversación de WhatsApp en la bandeja. */
export function EsqueletoTarjetaWhatsApp({ i = 0 }: { i?: number }) {
  const r = i * PASO;
  return (
    <div className="tarjeta flex items-start gap-3 p-4">
      <Circulo className="size-10" retraso={r} />
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex justify-between gap-3">
          <Linea className="h-3.5 w-2/5" retraso={r + 30} />
          <Linea className="w-10" retraso={r + 60} />
        </div>
        <Linea className="w-4/5" retraso={r + 90} />
        <Linea className="w-3/5" retraso={r + 120} />
      </div>
    </div>
  );
}

/** Bandeja de WhatsApp completa. */
export function EsqueletoBandejaWhatsApp({ cantidad = 3 }: { cantidad?: number }) {
  return (
    <Esqueleto className="flex flex-col gap-3">
      {rango(cantidad).map((i) => (
        <EsqueletoTarjetaWhatsApp key={i} i={i} />
      ))}
    </Esqueleto>
  );
}

/** Admin: encabezado + lista dentro de una tarjeta. `forma` ajusta cada fila. */
export function EsqueletoAdmin({ forma = 'menu', filas = 5 }: { forma?: 'menu' | 'equipo' | 'horarios' | 'envios'; filas?: number }) {
  return (
    <Esqueleto className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Linea className="h-7 w-40" />
        <Linea className="w-72 max-w-full" retraso={PASO} />
      </div>
      <div className="tarjeta divide-y divide-linea overflow-hidden">
        {rango(filas).map((i) => {
          const r = (i + 2) * PASO;
          return (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              {forma === 'equipo' && <Circulo retraso={r} />}
              {forma === 'horarios' ? (
                <>
                  <Linea className="w-24" retraso={r} />
                  <Bloque className="ml-auto h-9 w-24" retraso={r + 30} />
                  <Bloque className="h-9 w-24" retraso={r + 60} />
                </>
              ) : (
                <>
                  <div className="flex flex-1 flex-col gap-2">
                    <Linea className="h-3.5" style={{ width: `${60 - (i % 3) * 12}%` }} retraso={r + 30} />
                    <Linea className="w-1/4" retraso={r + 60} />
                  </div>
                  {forma === 'menu' && <Linea className="w-16" retraso={r + 90} />}
                  <Bloque className={forma === 'envios' ? 'h-9 w-20' : 'h-9 w-9'} retraso={r + 120} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </Esqueleto>
  );
}

/** Panel del operador: resumen + lista de locales. */
export function EsqueletoOperador() {
  return (
    <Esqueleto className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <Linea className="h-7 w-56" />
      <div className="grid gap-3 sm:grid-cols-3">
        {rango(3).map((i) => (
          <div key={i} className="tarjeta flex flex-col gap-3 p-5">
            <Linea className="w-1/2" retraso={i * PASO} />
            <Linea className="h-7 w-1/3" retraso={i * PASO + 40} />
          </div>
        ))}
      </div>
      <EsqueletoListaLocales />
    </Esqueleto>
  );
}

/** Filas de locales del operador (dentro de su tarjeta). */
export function EsqueletoListaLocales({ filas = 4 }: { filas?: number }) {
  return (
    <div role="status" aria-label="Cargando" className="divide-y divide-linea">
      {rango(filas).map((i) => (
        <div key={i} className="flex flex-col gap-3 px-5 py-4">
          <div className="flex gap-3">
            <Linea className="h-4 w-1/3" retraso={i * PASO} />
            <Linea className="w-20" retraso={i * PASO + 30} />
          </div>
          <div className="flex gap-2">
            {rango(3).map((k) => (
              <Bloque key={k} className="h-8 w-24" retraso={i * PASO + 60 + k * 30} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Entregas / últimos pedidos: filas de tickets chicos. */
export function EsqueletoPedidos({ filas = 4 }: { filas?: number }) {
  return (
    <Esqueleto className="flex flex-col gap-3">
      <Linea className="w-40" />
      {rango(filas).map((i) => (
        <div key={i} className="tarjeta flex items-center gap-4 px-4 py-3">
          <Bloque className="h-8 w-14" retraso={i * PASO} />
          <div className="flex flex-1 flex-col gap-2">
            <Linea className="w-3/5" retraso={i * PASO + 30} />
            <Linea className="w-1/4" retraso={i * PASO + 60} />
          </div>
          <Bloque className="h-9 w-24" retraso={i * PASO + 90} />
        </div>
      ))}
    </Esqueleto>
  );
}
