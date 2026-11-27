import { useEffect, useState } from 'react';
import { Icono } from './Icono.tsx';
import { ABRIR_TELEFONO } from './Tutorial.tsx';
import { SimuladorWhatsApp } from './SimuladorWhatsApp.tsx';

/**
 * Demo: el teléfono del cliente flotando sobre el mostrador. Un botón abajo a la derecha lo
 * abre (entra desde abajo con resorte; en el celular es una hoja inferior). Minimizado queda
 * montado para no perder la charla.
 */
export function TelefonoFlotante() {
  const [abierto, setAbierto] = useState(false);
  // Se monta recién la primera vez que se abre (no carga mensajes si nadie lo usa).
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => {
      // Escape lo minimiza, salvo que el tutorial esté abierto (ahí Escape cierra el tutorial).
      if (e.key === 'Escape' && !document.querySelector('[data-tutorial-activo]')) setAbierto(false);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [abierto]);

  // El tutorial lo abre solo si se saltó el paso de abrirlo.
  useEffect(() => {
    const alPedido = () => {
      setMontado(true);
      setAbierto(true);
    };
    window.addEventListener(ABRIR_TELEFONO, alPedido);
    return () => window.removeEventListener(ABRIR_TELEFONO, alPedido);
  }, []);

  function abrir() {
    setMontado(true);
    setAbierto(true);
    window.dispatchEvent(new CustomEvent('anotado:tutorial', { detail: 'telefono-abierto' }));
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        data-tutorial="telefono"
        data-abierto={abierto}
        aria-expanded={abierto}
        // Abierto queda invisible: que no se pueda enfocar ni lo lea el lector de pantalla.
        aria-hidden={abierto}
        inert={abierto}
        className={`btn btn-birome fixed right-4 bottom-4 z-40 shadow-alta transition-[opacity,translate] duration-300 ease-salida sm:right-6 sm:bottom-6 ${
          abierto ? 'pointer-events-none translate-y-3 opacity-0' : ''
        }`}
      >
        <Icono nombre="mensaje" />
        Escribir como cliente
      </button>

      {montado && (
        <section
          aria-label="Teléfono del cliente"
          aria-hidden={!abierto}
          inert={!abierto}
          className={`fixed inset-x-0 bottom-0 z-40 flex h-[82dvh] flex-col overflow-hidden rounded-t-2xl border border-linea bg-hoja shadow-alta transition-[translate,opacity] ease-resorte sm:inset-x-auto sm:right-6 sm:bottom-6 sm:h-[min(38rem,calc(100dvh-6rem))] sm:w-[22rem] sm:rounded-2xl ${
            abierto ? 'translate-y-0 opacity-100 duration-500' : 'pointer-events-none translate-y-[110%] opacity-0 duration-300'
          }`}
        >
          <div className="flex items-center gap-2 border-b border-linea px-3 py-2">
            <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-linea-fuerte sm:hidden" />
            <p className="rotulo max-sm:hidden">Teléfono del cliente</p>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Minimizar el teléfono"
              className="btn btn-fantasma btn-chico ml-auto w-8 px-0"
            >
              <Icono nombre="abajo" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <SimuladorWhatsApp />
          </div>
        </section>
      )}
    </>
  );
}
