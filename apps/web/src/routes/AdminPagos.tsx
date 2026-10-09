import { ETIQUETA_PAGO, leerPagos, MEDIOS_PAGO, type MedioPago } from '@anotado/shared';
import { useState } from 'react';
import { MensajeError, Nota } from '../components/Estado.tsx';
import { Icono } from '../components/Icono.tsx';
import { PieGuardar } from '../components/PieGuardar.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { supabase } from '../lib/supabase.ts';
import { Bloque, Encabezado } from './AdminLayout.tsx';

/** Formas de pago que acepta el local: el bot las nombra cuando un cliente pregunta. */
export function AdminPagos() {
  const negocio = useNegocio();
  const inicial = leerPagos(negocio.config);
  const [elegidos, setElegidos] = useState<MedioPago[]>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [guardadoEn, setGuardadoEn] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cambios = elegidos.join() !== inicial.join();

  const alternar = (m: MedioPago) =>
    setElegidos((e) => MEDIOS_PAGO.filter((x) => (x === m ? !e.includes(m) : e.includes(x))));

  async function guardar() {
    setError(null);
    const base = typeof negocio.config === 'object' && negocio.config !== null ? negocio.config : {};
    setGuardando(true);
    const { error } = await supabase
      .from('negocios')
      .update({ config: { ...base, pagos: elegidos } })
      .eq('id', negocio.id);
    setGuardando(false);
    if (error) return setError(error.message);
    setGuardadoEn(Date.now());
    negocio.recargar();
  }

  return (
    <>
      <Encabezado titulo="Formas de pago">
        Si un cliente pregunta cómo puede pagar, el bot le nombra las que marques acá.
      </Encabezado>
      <div className="flex flex-col gap-4">
        <Bloque titulo="Aceptamos">
          <div className="grid gap-2 sm:grid-cols-2">
            {MEDIOS_PAGO.map((m) => {
              const si = elegidos.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  role="checkbox"
                  aria-checked={si}
                  data-sonido="llave"
                  onClick={() => alternar(m)}
                  className={`flex h-12 items-center gap-3 rounded-xl border px-4 text-left font-semibold transition-colors ${
                    si ? 'border-tinta bg-tinta text-white' : 'border-linea-fuerte hover:border-tinta-3'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid size-5 place-items-center rounded-md border transition-colors ${
                      si ? 'border-white bg-white text-tinta' : 'border-linea-fuerte'
                    }`}
                  >
                    {si && <Icono nombre="check" className="size-3.5" />}
                  </span>
                  {ETIQUETA_PAGO[m]}
                </button>
              );
            })}
          </div>
        </Bloque>
        <Nota>
          Los datos para transferir (alias, número de cuenta) el bot no los manda: pasalos vos por WhatsApp. Así, aunque
          alguien entrara a tu cuenta, no podría cambiarlos para quedarse con la plata.
        </Nota>
        {error && <MensajeError>{error}</MensajeError>}
        <PieGuardar
          cambios={cambios}
          guardando={guardando}
          guardadoEn={guardadoEn}
          onGuardar={() => void guardar()}
          onDescartar={() => setElegidos(inicial)}
        />
      </div>
    </>
  );
}
