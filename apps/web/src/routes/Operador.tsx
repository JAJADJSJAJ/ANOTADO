import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { BotonSonido } from '../components/BotonSonido.tsx';
import { Compartir } from '../components/Compartir.tsx';
import { Cargando, MensajeError, PantallaMensaje, Vacio } from '../components/Estado.tsx';
import { Icono } from '../components/Icono.tsx';
import { Interruptor } from '../components/Interruptor.tsx';
import { Logo, Marca } from '../components/Marca.tsx';
import { usePreguntar } from '../lib/dialogos.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';

type EstadoOperador = { operador: boolean; segundo_factor: boolean };

type Codigo = {
  id: string;
  nota: string | null;
  created_at: string;
  vence_at: string;
  usado_at: string | null;
  negocio: string | null;
  estado: 'vigente' | 'usado' | 'vencido';
};

type Local = {
  id: string;
  nombre: string;
  slug: string;
  activo: boolean;
  ia_permitida: boolean;
  ia_activa: boolean;
  created_at: string;
  duenos: string[];
  miembros: number;
  pedidos_30d: number;
  usos_ia_30d: number;
  wa_phone_number_id: string | null;
};

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' });

/**
 * Panel del operador de Anotado: códigos de alta, IA por local y suspensión. No muestra nada
 * de adentro de los locales (pedidos, productos, clientes). La base exige que quien llama sea
 * operador Y haya verificado el código de la app del celular en esta sesión: esta pantalla
 * solo guía.
 */
export function Operador() {
  const [estado, setEstado] = useState<EstadoOperador | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('mi_estado_operador');
    if (error) setError(error.message);
    else setEstado(data as EstadoOperador);
  }, []);

  useEffect(() => {
    void supabase.rpc('mi_estado_operador').then(({ data, error }) => {
      if (error) setError(error.message);
      else setEstado(data as EstadoOperador);
    });
  }, []);

  if (error) {
    return (
      <PantallaMensaje titulo="No se pudo cargar">
        <MensajeError>{error}</MensajeError>
      </PantallaMensaje>
    );
  }
  if (!estado) return <Cargando />;
  if (!estado.operador) {
    return (
      <PantallaMensaje titulo="No tenés acceso">
        <Link to="/" className="btn">
          Volver
        </Link>
      </PantallaMensaje>
    );
  }
  if (!estado.segundo_factor) return <SegundoFactor onListo={() => void cargar()} />;
  return <Panel />;
}

function Panel() {
  const [locales, setLocales] = useState<Local[] | null>(null);
  const [codigos, setCodigos] = useState<Codigo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargarLocales = useCallback(async () => {
    const { data, error } = await supabase.rpc('operador_locales');
    if (error) setError(error.message);
    else setLocales((data ?? []) as Local[]);
  }, []);
  const cargarCodigos = useCallback(async () => {
    const { data, error } = await supabase.rpc('operador_codigos');
    if (error) setError(error.message);
    else setCodigos((data ?? []) as Codigo[]);
  }, []);

  useEffect(() => {
    void Promise.all([supabase.rpc('operador_locales'), supabase.rpc('operador_codigos')]).then(([l, c]) => {
      if (l.error ?? c.error) return setError((l.error ?? c.error)!.message);
      setLocales((l.data ?? []) as Local[]);
      setCodigos((c.data ?? []) as Codigo[]);
    });
  }, []);

  const activos = locales?.filter((l) => l.activo).length ?? 0;
  const pedidos = locales?.reduce((s, l) => s + l.pedidos_30d, 0) ?? 0;
  const usosIA = locales?.reduce((s, l) => s + l.usos_ia_30d, 0) ?? 0;
  const vigentes = codigos.filter((c) => c.estado === 'vigente').length;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-linea bg-hoja/95 backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 sm:px-5">
          <Marca />
          <span className="chip chip-tinta">Operador</span>
          <div className="ml-auto flex items-center gap-1">
            <Link to="/" className="btn btn-fantasma btn-chico">
              Mis locales
            </Link>
            <BotonSonido />
            <BotonSalir conTexto={false} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-3 py-6 sm:px-5 sm:py-8">
        <div>
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">Panel de Anotado</h1>
          <p className="mt-1.5 text-tinta-2">Altas, IA y suspensiones. Nada de lo que pasa adentro de cada local.</p>
        </div>

        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Dato titulo="Locales activos" valor={activos} de={locales?.length} />
          <Dato titulo="Pedidos" valor={pedidos} nota="últimos 30 días" />
          <Dato titulo="Usos de IA" valor={usosIA} nota="últimos 30 días" />
          <Dato titulo="Códigos vigentes" valor={vigentes} />
        </dl>

        {error && <MensajeError>{error}</MensajeError>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Locales locales={locales} onCambio={() => void cargarLocales()} onError={setError} />
          <Codigos
            codigos={codigos}
            onCambio={() => {
              void cargarCodigos();
              void cargarLocales();
            }}
            onError={setError}
          />
        </div>
      </main>
    </div>
  );
}

function Dato({ titulo, valor, de, nota }: { titulo: string; valor: number; de?: number; nota?: string }) {
  return (
    <div className="tarjeta animate-entra px-4 py-3.5">
      <dt className="text-sm font-medium text-tinta-2">{titulo}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className="num text-[1.75rem] leading-none font-extrabold">{valor.toLocaleString('es-UY')}</span>
        {de !== undefined && <span className="num text-sm text-tinta-3">de {de}</span>}
      </dd>
      {nota && <p className="mt-1 text-xs text-tinta-3">{nota}</p>}
    </div>
  );
}

/** Pide el código de la app del celular; la primera vez, la configura con un QR. */
function SegundoFactor({ onListo }: { onListo: () => void }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<{ svg: string; secreto: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Una sola vez: en desarrollo React corre los efectos dos veces, y dos configuraciones
  // simultáneas chocan ("ya existe un factor").
  const iniciado = useRef(false);
  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;
    void (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setError(error.message);
      const verificado = data.totp.find((f) => f.status === 'verified');
      if (verificado) return setFactorId(verificado.id);
      // Primera vez: se borran configuraciones a medias y se arma una nueva con su QR.
      for (const f of data.all.filter((f) => f.factor_type === 'totp' && f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const nuevo = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Celular' });
      if (nuevo.error) return setError(nuevo.error.message);
      setFactorId(nuevo.data.id);
      setQr({ svg: nuevo.data.totp.qr_code, secreto: nuevo.data.totp.secret });
    })();
  }, []);

  async function verificar(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setEnviando(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo.trim() });
    setEnviando(false);
    if (error) {
      efecto('error');
      return setError('Código incorrecto o vencido. Probá con el que aparece ahora en el celular.');
    }
    efecto('ok');
    onListo();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <form onSubmit={verificar} className="flex w-full max-w-sm animate-entra flex-col gap-5">
        <div>
          <Logo className="mb-6 size-9" />
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">Panel de Anotado</h1>
          <p className="mt-2 text-tinta-2">
            {qr
              ? 'Primera vez: escaneá el QR con la cámara del iPhone (se guarda en Contraseñas) o con Google Authenticator.'
              : 'Escribí el código de 6 números que te muestra la app del celular.'}
          </p>
        </div>
        {qr && (
          <div className="tarjeta flex flex-col items-center gap-3 p-5">
            <img src={qr.svg} alt="QR para la app de autenticación" className="size-44" />
            <p className="text-center text-xs text-tinta-3">
              Si no podés escanearlo, cargá esta clave a mano:
              <code className="num mt-1 block text-sm break-all text-tinta">{qr.secreto}</code>
            </p>
          </div>
        )}
        <label className="block">
          <span className="etiqueta">Código</span>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            placeholder="000000"
            className="campo num h-14 text-center text-2xl tracking-[0.4em]"
          />
        </label>
        {error && <MensajeError>{error}</MensajeError>}
        <button type="submit" disabled={enviando || !factorId || codigo.length < 6} data-sonido="no" className="btn btn-tinta btn-grande w-full">
          {enviando ? 'Verificando…' : 'Entrar al panel'}
        </button>
        <Link to="/" className="self-center text-sm text-tinta-2 transition-colors hover:text-tinta">
          Volver a mis locales
        </Link>
      </form>
    </main>
  );
}

function Codigos({
  codigos,
  onCambio,
  onError,
}: {
  codigos: Codigo[];
  onCambio: () => void;
  onError: (e: string | null) => void;
}) {
  const preguntar = usePreguntar();
  const [nota, setNota] = useState('');
  const [dias, setDias] = useState('14');
  const [nuevo, setNuevo] = useState<{ codigo: string; nota: string; dias: number } | null>(null);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  async function generar(e: FormEvent) {
    e.preventDefault();
    setErrorForm(null);
    const d = Number(dias);
    if (!Number.isInteger(d) || d < 1 || d > 90) return setErrorForm('La validez va de 1 a 90 días.');
    const { data, error } = await supabase.rpc('operador_crear_codigo', { p_nota: nota.trim() || undefined, p_dias: d });
    if (error) return setErrorForm(error.message);
    efecto('imprimir');
    setNuevo({ codigo: data as string, nota: nota.trim(), dias: d });
    setNota('');
    onCambio();
  }

  async function anular(c: Codigo) {
    const ok = await preguntar({
      titulo: `¿Anular el código${c.nota ? ` de "${c.nota}"` : ''}?`,
      texto: 'Ya no se va a poder usar para dar de alta un local.',
      aceptar: 'Anular',
      peligro: true,
    });
    if (ok === null) return;
    onError(null);
    const { error } = await supabase.rpc('operador_anular_codigo', { p_codigo_id: c.id });
    if (error) onError(error.message);
    onCambio();
  }

  const link = nuevo && `${window.location.origin}/registro?codigo=${nuevo.codigo}`;

  return (
    <section className="tarjeta lg:sticky lg:top-[4.75rem]">
      <header className="border-b border-linea px-5 py-4">
        <h2 className="font-bold">Códigos de alta</h2>
        <p className="mt-0.5 text-sm text-tinta-2">Uno por local nuevo. Sirve una sola vez.</p>
      </header>
      <form onSubmit={generar} className="flex flex-col gap-3 px-5 pt-4">
        <label className="block">
          <span className="etiqueta">Para quién</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} placeholder="Pizzería Don José" className="campo" />
        </label>
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="etiqueta">Vence en</span>
            <span className="flex items-center gap-2">
              <input value={dias} onChange={(e) => setDias(e.target.value)} inputMode="numeric" className="campo num w-16 text-center" />
              <span className="text-sm text-tinta-2">días</span>
            </span>
          </label>
          <button type="submit" data-sonido="no" className="btn btn-tinta ml-auto h-11">
            Generar código
          </button>
        </div>
        {errorForm && <MensajeError>{errorForm}</MensajeError>}
      </form>
      <div className="px-5">
        {nuevo && link && (
          <Compartir
            key={nuevo.codigo}
            titulo={`Código${nuevo.nota ? ` para ${nuevo.nota}` : ''}`}
            valor={nuevo.codigo}
            grande
            copiar={link}
            textoWhatsApp={`Hola${nuevo.nota ? ` ${nuevo.nota}` : ''}! Para dar de alta tu local en Anotado entrá acá: ${link} (el código es ${nuevo.codigo} y vence en ${nuevo.dias} días).`}
            aviso="Guardalo ahora: no se puede volver a ver. Si se pierde, anulalo y generá otro."
          />
        )}
      </div>

      {codigos.length > 0 && (
        <ul className="mt-4 divide-y divide-linea border-t border-linea">
          {codigos.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${c.nota ? '' : 'text-tinta-3'}`}>{c.nota ?? 'Sin nota'}</p>
                <p className="num text-xs text-tinta-3">
                  {c.estado === 'vigente' ? `vence ${fecha(c.vence_at)}` : `creado ${fecha(c.created_at)}`}
                </p>
              </div>
              {c.estado === 'usado' && <span className="chip chip-ok max-w-36 truncate">{c.negocio ?? 'Usado'}</span>}
              {c.estado === 'vencido' && <span className="chip">Vencido</span>}
              {c.estado === 'vigente' && (
                <>
                  <span className="chip chip-birome chip-punto">Vigente</span>
                  <button type="button" onClick={() => void anular(c)} className="btn btn-quitar btn-chico -mr-2">
                    Anular
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Locales({
  locales,
  onCambio,
  onError,
}: {
  locales: Local[] | null;
  onCambio: () => void;
  onError: (e: string | null) => void;
}) {
  const preguntar = usePreguntar();

  async function accion(llamada: PromiseLike<{ error: { message: string } | null }>) {
    onError(null);
    const { error } = await llamada;
    if (error) {
      efecto('error');
      onError(error.message);
    }
    onCambio();
  }

  async function suspender(l: Local) {
    const motivo = await preguntar({
      titulo: `¿Suspender "${l.nombre}"?`,
      texto: 'Su gente no va a poder entrar hasta que lo reactives.',
      aceptar: 'Suspender',
      peligro: true,
      campo: { etiqueta: 'Motivo (opcional)', maxLength: 200 },
    });
    if (motivo === null) return;
    void accion(supabase.rpc('operador_cambiar_activo', { p_negocio_id: l.id, p_activo: false, p_motivo: motivo || undefined }));
  }

  /** El phone_number_id lo da Meta (WhatsApp → API Setup). Vacío = desconectar. */
  async function conectarWhatsApp(l: Local) {
    const id = await preguntar({
      titulo: `WhatsApp de "${l.nombre}"`,
      texto: 'El identificador del número (Phone number ID) lo da Meta en WhatsApp → API Setup.',
      aceptar: 'Guardar',
      campo: {
        etiqueta: 'Phone number ID',
        inicial: l.wa_phone_number_id ?? '',
        placeholder: '1346142381918735',
        ayuda: 'Dejalo vacío para desconectar el número.',
      },
    });
    if (id === null) return;
    void accion(supabase.rpc('operador_conectar_whatsapp', { p_negocio_id: l.id, p_phone_number_id: id.trim() }));
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex items-baseline gap-2 border-b border-linea px-5 py-4">
        <h2 className="font-bold">Locales</h2>
        {locales && <span className="num text-sm text-tinta-3">{locales.length}</span>}
      </header>
      {!locales ? (
        <Cargando />
      ) : locales.length === 0 ? (
        <Vacio icono="tienda" titulo="Todavía no hay locales">
          Generá un código de alta y mandáselo al dueño.
        </Vacio>
      ) : (
        <ul className="divide-y divide-linea">
          {locales.map((l) => (
            <li key={l.id} className={`flex flex-col gap-3 px-5 py-4 ${l.activo ? '' : 'bg-peligro-suave/40'}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[1.0625rem] font-bold">{l.nombre}</span>
                <span className="num text-xs text-tinta-3">
                  /{l.slug} · alta {fecha(l.created_at)}
                </span>
                {!l.activo && <span className="chip chip-peligro chip-punto">Suspendido</span>}
                <span className="num ml-auto flex gap-4 text-sm text-tinta-2">
                  <span>
                    <strong className="font-bold text-tinta">{l.pedidos_30d}</strong> pedidos
                  </span>
                  <span>
                    <strong className="font-bold text-tinta">{l.usos_ia_30d}</strong> IA
                  </span>
                </span>
              </div>
              <p className="truncate text-sm text-tinta-2">
                {l.duenos.join(', ') || 'Sin dueño'} · {l.miembros} {l.miembros === 1 ? 'persona' : 'personas'}
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="flex items-center gap-2.5 text-sm">
                  <Interruptor
                    prendido={l.ia_permitida}
                    etiqueta={`IA habilitada en ${l.nombre}`}
                    onCambio={(v) => void accion(supabase.rpc('operador_cambiar_ia', { p_negocio_id: l.id, p_permitida: v }))}
                  />
                  <span className="font-medium">IA</span>
                  {l.ia_permitida && !l.ia_activa && <span className="text-tinta-3">el dueño la apagó</span>}
                </span>
                <button type="button" onClick={() => void conectarWhatsApp(l)} className="btn btn-chico">
                  <Icono nombre="mensaje" className="size-4" />
                  {l.wa_phone_number_id ? (
                    <>
                      WhatsApp <span className="num font-normal text-tinta-3">{l.wa_phone_number_id}</span>
                    </>
                  ) : (
                    'Conectar WhatsApp'
                  )}
                </button>
                {l.activo ? (
                  <button type="button" onClick={() => void suspender(l)} className="btn btn-quitar btn-chico ml-auto">
                    Suspender
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void accion(supabase.rpc('operador_cambiar_activo', { p_negocio_id: l.id, p_activo: true }))}
                    className="btn btn-tinta btn-chico ml-auto"
                  >
                    Reactivar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
