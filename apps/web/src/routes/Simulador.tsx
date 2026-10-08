import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { SimuladorWhatsApp } from '../components/SimuladorWhatsApp.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { Cocina } from './Cocina.tsx';
import { Mostrador } from './Mostrador.tsx';

/**
 * La demo en una pantalla: el teléfono del cliente, el mostrador y la cocina, uno al lado del
 * otro. Solo en locales de demo. En pantallas angostas van uno abajo del otro.
 */
export function Simulador() {
  const negocio = useNegocio();
  if (!negocio.esDemo) return <Navigate to="../mostrador" replace />;

  return (
    <div className="flex flex-1 flex-col">
      <p className="flex items-center gap-2.5 border-b border-linea bg-hoja px-3 py-2 text-[0.8125rem] text-tinta-2 sm:px-5">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-alerta" />
        <span>
          <span className="font-semibold text-tinta">Demo compartida.</span> Otros visitantes ven lo mismo que vos. No escribas
          datos reales: se borra todo cada noche.
        </span>
      </p>
      <div className="grid flex-1 gap-5 p-3 sm:p-5 xl:grid-cols-[21rem_minmax(0,1fr)_23rem] xl:gap-6">
        <Columna paso="01" titulo="El cliente escribe" fija>
          <SimuladorWhatsApp />
        </Columna>
        <Columna paso="02" titulo="El mostrador revisa y confirma">
          <Mostrador compacto />
        </Columna>
        <Columna paso="03" titulo="La cocina lo prepara" fija>
          <div className="h-[34rem] overflow-hidden rounded-[14px] xl:h-full">
            <Cocina incrustada />
          </div>
        </Columna>
      </div>
    </div>
  );
}

/** Una columna de la demo con su paso. Las fijas acompañan el scroll en pantallas anchas. */
function Columna({ paso, titulo, fija = false, children }: { paso: string; titulo: string; fija?: boolean; children: ReactNode }) {
  return (
    <section
      aria-label={titulo}
      className={`flex min-w-0 animate-entra flex-col gap-3 ${fija ? 'xl:sticky xl:top-[4.75rem] xl:h-[calc(100dvh-8.25rem)]' : ''}`}
    >
      <h2 className="flex items-baseline gap-2.5 px-0.5">
        <span className="num text-[0.6875rem] font-extrabold text-birome">{paso}</span>
        <span className="text-sm font-bold tracking-[-0.01em]">{titulo}</span>
      </h2>
      {children}
    </section>
  );
}
