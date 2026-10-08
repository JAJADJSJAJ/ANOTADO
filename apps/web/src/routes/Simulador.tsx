import { Navigate } from 'react-router';
import { SimuladorWhatsApp } from '../components/SimuladorWhatsApp.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { Cocina } from './Cocina.tsx';
import { Mostrador } from './Mostrador.tsx';

/**
 * La demo en una pantalla: el teléfono del cliente, el mostrador y la cocina, uno al lado del
 * otro. Solo en locales de demo. El diseño es provisorio (se rehace con el CSS nuevo).
 */
export function Simulador() {
  const negocio = useNegocio();
  if (!negocio.esDemo) return <Navigate to="../mostrador" replace />;

  return (
    <div className="flex flex-1 flex-col">
      <p className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950">
        Demo compartida: otros visitantes ven lo mismo que vos. No escribas datos reales. Podés pedir, confirmar, cocinar
        y agregar hasta 3 productos al menú. Se borra todo cada noche.
      </p>
      <div className="grid flex-1 gap-4 p-4 xl:grid-cols-[22rem_minmax(0,1fr)_26rem]">
        <aside className="flex flex-col gap-2 xl:sticky xl:top-4 xl:h-[calc(100vh-7rem)]">
          <h2 className="text-sm font-bold tracking-widest text-stone-500 uppercase">1 · El cliente escribe</h2>
          <SimuladorWhatsApp />
        </aside>
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="px-4 text-sm font-bold tracking-widest text-stone-500 uppercase">2 · El mostrador revisa y confirma</h2>
          <Mostrador pestanaInicial="whatsapp" />
        </section>
        <section className="flex flex-col gap-2 xl:sticky xl:top-4 xl:h-[calc(100vh-7rem)]">
          <h2 className="text-sm font-bold tracking-widest text-stone-500 uppercase">3 · La cocina lo prepara</h2>
          <div className="h-[32rem] overflow-hidden rounded-3xl xl:h-full">
            <Cocina incrustada />
          </div>
        </section>
      </div>
    </div>
  );
}
