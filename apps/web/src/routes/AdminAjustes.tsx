import { ConfigCocinaSchema, leerConfigCocina, MAX_MINUTOS_COCINA } from '@anotado/shared';
import { useState } from 'react';
import { MensajeError } from '../components/Estado.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { supabase } from '../lib/supabase.ts';

/** Ajustes del local (dueño): IA y tiempos del temporizador de cocina. */
export function AdminAjustes() {
  const negocio = useNegocio();
  const inicial = leerConfigCocina(negocio.config);
  const [iaActiva, setIaActiva] = useState(negocio.iaActiva);
  const [amarillo, setAmarillo] = useState(String(inicial.amarilloMin));
  const [rojo, setRojo] = useState(String(inicial.rojoMin));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  async function guardar() {
    setError(null);
    setGuardado(false);
    const cocina = ConfigCocinaSchema.safeParse({ amarillo_min: Number(amarillo), rojo_min: Number(rojo) });
    if (!cocina.success) {
      return setError(
        `Los tiempos van en minutos enteros, de 1 a ${MAX_MINUTOS_COCINA}, y el rojo tiene que ser mayor que el amarillo.`,
      );
    }
    const base = typeof negocio.config === 'object' && negocio.config !== null ? negocio.config : {};
    setGuardando(true);
    const { error } = await supabase
      .from('negocios')
      .update({ ia_activa: iaActiva, config: { ...base, cocina: cocina.data } })
      .eq('id', negocio.id);
    setGuardando(false);
    if (error) return setError(error.message);
    setGuardado(true);
    negocio.recargar();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-black">Ajustes del local</h1>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">IA para pedidos de WhatsApp</h2>
        {negocio.iaPermitida ? (
          <>
            <p className="mt-1 text-stone-600">
              Interpreta los mensajes que pegás en el mostrador y arma el pedido. Siempre lo confirma una persona.
            </p>
            <label className="mt-4 flex items-center gap-3 text-lg font-semibold">
              <input
                type="checkbox"
                checked={iaActiva}
                onChange={(e) => setIaActiva(e.target.checked)}
                className="size-6 accent-indigo-600"
              />
              {iaActiva ? 'Prendida' : 'Apagada'}
            </label>
          </>
        ) : (
          <p className="mt-2 rounded-xl bg-stone-100 p-3 text-stone-700">
            La IA no está habilitada para este local. Para activarla, hablá con Anotado.
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Temporizador de cocina</h2>
        <p className="mt-1 text-stone-600">
          Cada pedido muestra los minutos desde que entró y cambia de color para avisar que se está demorando.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <CampoMinutos etiqueta="Pasa a amarillo a los" color="bg-amber-400" valor={amarillo} onCambio={setAmarillo} />
          <CampoMinutos etiqueta="Pasa a rojo a los" color="bg-red-600" valor={rojo} onCambio={setRojo} />
        </div>
      </section>

      {error && <MensajeError>{error}</MensajeError>}
      {guardado && (
        <p role="status" className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-3 font-bold text-emerald-900">
          Ajustes guardados.
        </p>
      )}
      <button
        type="button"
        disabled={guardando}
        onClick={() => void guardar()}
        className="self-start rounded-xl bg-indigo-600 px-6 py-3 text-lg font-bold text-white active:bg-indigo-700 disabled:opacity-60"
      >
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </main>
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
    <label className="flex flex-col gap-1 font-medium">
      <span className="flex items-center gap-2">
        <span aria-hidden className={`size-3 rounded-full ${color}`} />
        {etiqueta}
      </span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_MINUTOS_COCINA}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          className="w-24 rounded-xl border-2 border-stone-300 px-3 py-2 text-lg"
        />
        minutos
      </span>
    </label>
  );
}
