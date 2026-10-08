import { ConfigCocinaSchema, leerConfigCocina, MAX_MINUTOS_COCINA } from '@anotado/shared';
import { useState } from 'react';
import { MensajeError } from '../components/Estado.tsx';
import { PieGuardar } from '../components/PieGuardar.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { Bloque, Encabezado } from './AdminLayout.tsx';

/** Cuándo un pedido en la cocina pasa a amarillo y a rojo. */
export function AdminCocina() {
  const negocio = useNegocio();
  const inicial = leerConfigCocina(negocio.config);
  const [amarillo, setAmarillo] = useState(String(inicial.amarilloMin));
  const [rojo, setRojo] = useState(String(inicial.rojoMin));
  const [guardando, setGuardando] = useState(false);
  const [guardadoEn, setGuardadoEn] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cambios = amarillo !== String(inicial.amarilloMin) || rojo !== String(inicial.rojoMin);

  async function guardar() {
    setError(null);
    const cocina = ConfigCocinaSchema.safeParse({ amarillo_min: Number(amarillo), rojo_min: Number(rojo) });
    if (!cocina.success) {
      efecto('error');
      return setError(
        `Los tiempos van en minutos enteros, de 1 a ${MAX_MINUTOS_COCINA}, y el rojo tiene que ser mayor que el amarillo.`,
      );
    }
    const base = typeof negocio.config === 'object' && negocio.config !== null ? negocio.config : {};
    setGuardando(true);
    const { error } = await supabase
      .from('negocios')
      .update({ config: { ...base, cocina: cocina.data } })
      .eq('id', negocio.id);
    setGuardando(false);
    if (error) return setError(error.message);
    setGuardadoEn(Date.now());
    negocio.recargar();
  }

  const a = Number(amarillo);
  const r = Number(rojo);
  const valido = Number.isInteger(a) && Number.isInteger(r) && a >= 1 && r > a;

  return (
    <>
      <Encabezado titulo="Cocina">
        Cada ticket muestra los minutos desde que entró el pedido y cambia de color cuando se demora.
      </Encabezado>
      <div className="flex flex-col gap-4">
        <Bloque titulo="Temporizador">
          <div className="grid gap-5 sm:grid-cols-2">
            <CampoMinutos etiqueta="Pasa a amarillo a los" color="bg-alerta" valor={amarillo} onCambio={setAmarillo} />
            <CampoMinutos etiqueta="Pasa a rojo a los" color="bg-peligro" valor={rojo} onCambio={setRojo} />
          </div>
          {valido && <Linea amarillo={a} rojo={r} />}
        </Bloque>
        {error && <MensajeError>{error}</MensajeError>}
        <PieGuardar
          cambios={cambios}
          guardando={guardando}
          guardadoEn={guardadoEn}
          onGuardar={() => void guardar()}
          onDescartar={() => {
            setAmarillo(String(inicial.amarilloMin));
            setRojo(String(inicial.rojoMin));
          }}
        />
      </div>
    </>
  );
}

/** Cómo se ve el tiempo de un pedido: verde, después amarillo, después rojo. */
function Linea({ amarillo, rojo }: { amarillo: number; rojo: number }) {
  const total = Math.max(rojo * 1.35, rojo + 5);
  const pct = (m: number) => `${(m / total) * 100}%`;
  return (
    <div className="mt-6" aria-hidden>
      <div className="flex h-2 overflow-hidden rounded-full">
        <span className="bg-ok transition-[width] duration-300 ease-salida" style={{ width: pct(amarillo) }} />
        <span className="bg-alerta transition-[width] duration-300 ease-salida" style={{ width: pct(rojo - amarillo) }} />
        <span className="flex-1 bg-peligro" />
      </div>
      <div className="relative mt-2 h-4 text-xs text-tinta-3">
        <span className="num absolute left-0">0</span>
        <span className="num absolute -translate-x-1/2 transition-[left] duration-300 ease-salida" style={{ left: pct(amarillo) }}>
          {amarillo} min
        </span>
        <span className="num absolute -translate-x-1/2 transition-[left] duration-300 ease-salida" style={{ left: pct(rojo) }}>
          {rojo} min
        </span>
      </div>
    </div>
  );
}

function CampoMinutos({
  etiqueta,
  color,
  valor,
  onCambio,
}: {
  etiqueta: string;
  color: string;
  valor: string;
  onCambio: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="etiqueta flex items-center gap-2">
        <span aria-hidden className={`size-2.5 rounded-full ${color}`} />
        {etiqueta}
      </span>
      <span className="flex items-center gap-2.5">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_MINUTOS_COCINA}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          className="campo num w-24"
        />
        <span className="text-tinta-2">minutos</span>
      </span>
    </label>
  );
}
