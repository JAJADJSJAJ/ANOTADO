import { useState } from 'react';
import { MensajeError, Nota } from '../components/Estado.tsx';
import { Interruptor } from '../components/Interruptor.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { Bloque, Encabezado } from './AdminLayout.tsx';

/** Prender o apagar la IA que arma los pedidos de WhatsApp. La habilita el operador de Anotado. */
export function AdminIA() {
  const negocio = useNegocio();
  const [activa, setActiva] = useState(negocio.iaActiva);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cambiar(v: boolean) {
    setError(null);
    setActiva(v);
    setGuardando(true);
    const { error } = await supabase.from('negocios').update({ ia_activa: v }).eq('id', negocio.id);
    setGuardando(false);
    if (error) {
      setActiva(!v);
      efecto('error');
      return setError(error.message);
    }
    negocio.recargar();
  }

  return (
    <>
      <Encabezado titulo="IA de WhatsApp">
        Lee los mensajes de los clientes y arma el pedido. Siempre lo revisa y lo confirma una persona del local.
      </Encabezado>
      <div className="flex flex-col gap-4">
        {negocio.iaPermitida ? (
          <Bloque>
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{activa ? 'Prendida' : 'Apagada'}</p>
                <p className="mt-0.5 text-sm text-tinta-2">
                  {activa
                    ? 'Los mensajes nuevos se interpretan solos y el pedido aparece armado en el mostrador.'
                    : 'Los mensajes llegan igual, pero el pedido se arma a mano en el mostrador.'}
                </p>
              </div>
              <Interruptor prendido={activa} onCambio={(v) => void cambiar(v)} etiqueta="IA de WhatsApp" disabled={guardando} />
            </div>
          </Bloque>
        ) : (
          <Nota>La IA no está habilitada para este local. Para activarla, hablá con Anotado.</Nota>
        )}
        {error && <MensajeError>{error}</MensajeError>}
      </div>
    </>
  );
}
