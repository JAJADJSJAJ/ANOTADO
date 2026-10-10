import { aConfigGuardada, type ConfigAuto, formatearPrecio, leerConfigAuto, parsearPrecio } from '@anotado/shared';
import { type ReactNode, useState } from 'react';
import { MensajeError, Nota } from '../components/Estado.tsx';
import { Interruptor } from '../components/Interruptor.tsx';
import { PieGuardar } from '../components/PieGuardar.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { Bloque, Encabezado } from './AdminLayout.tsx';

/**
 * Confirmación automática: cuando el cliente termina, el bot le manda el resumen con el total y,
 * si responde "sí" y todo está dentro de estos topes, el pedido se confirma solo.
 */
export function AdminAutomatico() {
  const negocio = useNegocio();
  const inicial = leerConfigAuto(negocio.config);
  const [c, setC] = useState<ConfigAuto>(inicial);
  const [total, setTotal] = useState(formatearPrecio(inicial.maxTotalCentavos).replace('$ ', ''));
  const [guardando, setGuardando] = useState(false);
  const [guardadoEn, setGuardadoEn] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cambios =
    JSON.stringify(c) !== JSON.stringify(inicial) || total !== formatearPrecio(inicial.maxTotalCentavos).replace('$ ', '');

  const cambiar = <K extends keyof ConfigAuto>(k: K, v: ConfigAuto[K]) => setC((x) => ({ ...x, [k]: v }));

  async function guardar() {
    setError(null);
    const centavos = parsearPrecio(total);
    if (centavos === null || centavos <= 0) {
      efecto('error');
      return setError('Revisá el total máximo: por ejemplo 3000.');
    }
    setGuardando(true);
    // Solo esta sección: guardar_config no pisa lo que otro dueño haya guardado en las demás.
    const { error } = await supabase.rpc('guardar_config', {
      p_negocio_id: negocio.id,
      p_clave: 'auto',
      p_valor: aConfigGuardada({ ...c, maxTotalCentavos: centavos }),
    });
    setGuardando(false);
    if (error) return setError(error.message);
    setGuardadoEn(Date.now());
    negocio.recargar();
  }

  return (
    <>
      <Encabezado titulo="Confirmación automática">
        Para que los pedidos no dependan de que alguien esté mirando la pantalla. El cliente siempre confirma el resumen con
        el total antes.
      </Encabezado>
      <div className="flex flex-col gap-4">
        <Bloque>
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{c.activa ? 'Prendida' : 'Apagada'}</p>
              <p className="mt-0.5 text-sm text-tinta-2">
                {c.activa
                  ? 'Si el cliente responde SÍ al resumen y el pedido está dentro de los topes, se confirma solo y va a la cocina.'
                  : 'Todos los pedidos los confirma una persona en el mostrador.'}
              </p>
            </div>
            <Interruptor prendido={c.activa} onCambio={(v) => cambiar('activa', v)} etiqueta="Confirmación automática" />
          </div>
        </Bloque>

        <Bloque titulo="Topes" descripcion="Lo que se pase de esto lo confirma una persona. El cajero ve por qué.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Campo etiqueta="Total máximo" ayuda="Pedidos más caros van a mano.">
              <span className="relative block w-36">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-tinta-3">$</span>
                <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className="campo num pl-7" />
              </span>
            </Campo>
            <Numero
              etiqueta="Máximo por producto"
              ayuda="Para que nadie pida 100 hamburguesas."
              valor={c.maxPorProducto}
              min={1}
              max={20}
              unidad="unidades"
              onCambio={(v) => cambiar('maxPorProducto', v)}
            />
            <Numero
              etiqueta="Pedidos por cliente por día"
              ayuda="Automáticos. Frena a quien manda muchos."
              valor={c.maxPedidosClienteDia}
              min={1}
              max={50}
              unidad="pedidos"
              onCambio={(v) => cambiar('maxPedidosClienteDia', v)}
            />
            <Numero
              etiqueta="Pedidos esperando en la cocina"
              ayuda="Con más que esto, los nuevos van a mano."
              valor={c.maxEnCocina}
              min={1}
              max={500}
              unidad="pedidos"
              onCambio={(v) => cambiar('maxEnCocina', v)}
            />
          </div>
        </Bloque>

        <Bloque titulo="Clientes nuevos">
          <div className="flex items-center gap-4">
            <p className="min-w-0 flex-1 text-sm text-tinta-2">
              El primer pedido de un número que nunca pidió lo confirma una persona. Frena bromas y direcciones falsas sin
              molestar a los clientes de siempre.
            </p>
            <Interruptor prendido={c.nuevosAMano} onCambio={(v) => cambiar('nuevosAMano', v)} etiqueta="Primer pedido a mano" />
          </div>
        </Bloque>

        <Bloque titulo="Si nadie confirma">
          <Numero
            etiqueta="Avisarle al cliente a los"
            ayuda="Si un pedido quedó para confirmar a mano y nadie lo hizo, el bot le avisa que hay demora."
            valor={c.esperaMinutos}
            min={1}
            max={240}
            unidad="minutos"
            onCambio={(v) => cambiar('esperaMinutos', v)}
          />
        </Bloque>

        <Nota>
          El stock de cada producto se carga en Menú. Lo que se termina pasa solo a agotado, y si dos clientes piden lo último a
          la vez, el pedido se le confirma a uno solo: al otro el bot le avisa que se terminó.
        </Nota>
        {error && <MensajeError>{error}</MensajeError>}
        <PieGuardar
          cambios={cambios}
          guardando={guardando}
          guardadoEn={guardadoEn}
          onGuardar={() => void guardar()}
          onDescartar={() => {
            setC(inicial);
            setTotal(formatearPrecio(inicial.maxTotalCentavos).replace('$ ', ''));
          }}
        />
      </div>
    </>
  );
}

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      {children}
      <span className="mt-1.5 block text-sm text-tinta-3">{ayuda}</span>
    </label>
  );
}

function Numero(p: {
  etiqueta: string;
  ayuda: string;
  valor: number;
  min: number;
  max: number;
  unidad: string;
  onCambio: (v: number) => void;
}) {
  return (
    <Campo etiqueta={p.etiqueta} ayuda={p.ayuda}>
      <span className="flex items-center gap-2.5">
        <input
          type="number"
          inputMode="numeric"
          min={p.min}
          max={p.max}
          value={p.valor}
          onChange={(e) => {
            const n = Math.trunc(Number(e.target.value));
            if (Number.isFinite(n)) p.onCambio(Math.min(p.max, Math.max(p.min, n)));
          }}
          className="campo num w-24"
        />
        <span className="text-tinta-2">{p.unidad}</span>
      </span>
    </Campo>
  );
}
