import { DIAS, type Horarios, HorariosSchema } from '@anotado/shared';
import { useState } from 'react';
import { EditorHorarios } from '../components/EditorHorarios.tsx';
import { EstadoLocal } from '../components/EstadoLocal.tsx';
import { MensajeError } from '../components/Estado.tsx';
import { PieGuardar } from '../components/PieGuardar.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { Bloque, Encabezado } from './AdminLayout.tsx';

/** Turnos de cada día. Solo avisan en el mostrador si el local está abierto: no bloquean. */
export function AdminHorarios() {
  const negocio = useNegocio();
  const [horarios, setHorarios] = useState<Horarios>(negocio.horarios);
  const [guardando, setGuardando] = useState(false);
  const [guardadoEn, setGuardadoEn] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cambios = !mismosHorarios(horarios, negocio.horarios);

  async function guardar() {
    setError(null);
    const turnos = HorariosSchema.safeParse(horarios);
    if (!turnos.success) {
      efecto('error');
      return setError('Revisá los horarios: cada turno necesita hora de apertura y de cierre, distintas.');
    }
    setGuardando(true);
    const { error } = await supabase.from('negocios').update({ horarios: turnos.data }).eq('id', negocio.id);
    setGuardando(false);
    if (error) return setError(error.message);
    setGuardadoEn(Date.now());
    negocio.recargar();
  }

  return (
    <>
      <Encabezado titulo="Horarios" acciones={<EstadoLocal horarios={negocio.horarios} zonaHoraria={negocio.zonaHoraria} />}>
        El mostrador muestra si el local está abierto. Es solo un aviso: se pueden tomar pedidos igual.
      </Encabezado>
      <div className="flex flex-col gap-4">
        <Bloque
          titulo="Turnos de la semana"
          descripcion="Un turno que termina después de medianoche va igual: de 19:00 a 01:30."
        >
          <EditorHorarios valor={horarios} onCambio={setHorarios} />
        </Bloque>
        {error && <MensajeError>{error}</MensajeError>}
        <PieGuardar
          cambios={cambios}
          guardando={guardando}
          guardadoEn={guardadoEn}
          onGuardar={() => void guardar()}
          onDescartar={() => setHorarios(negocio.horarios)}
        />
      </div>
    </>
  );
}

/** Día por día: la base guarda el jsonb con otro orden de claves y un día sin turnos puede faltar. */
function mismosHorarios(a: Horarios, b: Horarios): boolean {
  return DIAS.every((d) => JSON.stringify(a[d] ?? []) === JSON.stringify(b[d] ?? []));
}
