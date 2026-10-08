import { useState } from 'react';
import { efecto } from '../lib/sonido.ts';
import { Icono } from './Icono.tsx';

/**
 * Algo que se ve una sola vez y hay que pasárselo a otra persona (link de invitación, código
 * de alta): impreso como un ticket, con WhatsApp y copiar.
 */
export function Compartir({
  titulo,
  valor,
  grande = false,
  textoWhatsApp,
  copiar = valor,
  aviso,
}: {
  titulo: string;
  valor: string;
  grande?: boolean;
  textoWhatsApp: string;
  copiar?: string;
  aviso: string;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="ticket mt-4 animate-imprimir rounded-t-xl border border-b-0 border-linea px-4 pt-4 shadow-papel">
      <p className="rotulo">{titulo}</p>
      <p className={`num mt-2 font-bold break-all ${grande ? 'text-center text-2xl tracking-wider' : 'text-sm'}`}>{valor}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(textoWhatsApp)}`} target="_blank" rel="noreferrer" className="btn btn-tinta">
          <Icono nombre="mensaje" />
          Mandar por WhatsApp
        </a>
        <button
          type="button"
          data-sonido="no"
          onClick={() =>
            void navigator.clipboard.writeText(copiar).then(() => {
              efecto('ok');
              setCopiado(true);
            })
          }
          className="btn"
        >
          <Icono nombre={copiado ? 'check' : 'copiar'} />
          {copiado ? 'Copiado' : 'Copiar link'}
        </button>
      </div>
      <p className="mt-3 text-sm text-tinta-2">{aviso}</p>
    </div>
  );
}
