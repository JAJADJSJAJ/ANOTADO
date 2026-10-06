import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BotonSalir } from '../components/BotonSalir.tsx';
import { Cargando, MensajeError, PantallaMensaje } from '../components/Estado.tsx';
import { Logo } from '../components/Marca.tsx';
import { supabase } from '../lib/supabase.ts';

type EstadoOperador = { operador: boolean; segundo_factor: boolean };

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
        <Link to="/" className="font-medium underline">
          Volver
        </Link>
      </PantallaMensaje>
    );
  }
  if (!estado.segundo_factor) return <SegundoFactor onListo={() => void cargar()} />;

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="flex items-center gap-3 bg-stone-900 px-4 py-3 text-white">
        <Logo className="size-7" />
        <span className="text-lg font-bold">Panel de Anotado</span>
        <Link to="/" className="ml-auto rounded-lg px-3 py-2 font-medium text-stone-300 underline">
          Mis locales
        </Link>
        <BotonSalir className="text-stone-300" />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <Codigos />
        <Locales />
      </main>
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
    if (error) return setError('Código incorrecto o vencido. Probá con el que aparece ahora en el celular.');
    onListo();
  }

  return (
    <PantallaMensaje titulo="Panel de Anotado">
      <form onSubmit={verificar} className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white p-6 text-left shadow-xl">
        {qr ? (
          <>
            <p className="text-stone-700">
              Primera vez: escaneá este QR con la cámara del iPhone (se guarda en <strong>Contraseñas</strong>) o con
              Google Authenticator. Después escribí el código de 6 números que te muestra.
            </p>
            <img src={qr.svg} alt="QR para la app de autenticación" className="mx-auto size-48" />
            <p className="text-sm break-all text-stone-500">
              Si no podés escanearlo, cargá esta clave a mano: <code>{qr.secreto}</code>
            </p>
          </>
        ) : (
          <p className="text-stone-700">Escribí el código de 6 números que te muestra la app del celular.</p>
        )}
        <label className="flex flex-col gap-1 font-medium">
          Código
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            className="rounded-xl border-2 border-stone-300 px-3 py-3 text-center text-2xl tracking-widest"
          />
        </label>
        {error && <MensajeError>{error}</MensajeError>}
        <button
          type="submit"
          disabled={enviando || !factorId}
          className="rounded-xl bg-indigo-600 py-4 text-lg font-bold text-white disabled:opacity-50"
        >
          {enviando ? 'Verificando…' : 'Entrar al panel'}
        </button>
      </form>
    </PantallaMensaje>
  );
}

type Codigo = {
  id: string;
  nota: string | null;
  created_at: string;
  vence_at: string;
  usado_at: string | null;
  negocio: string | null;
  estado: 'vigente' | 'usado' | 'vencido';
};

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' });

function Codigos() {
  const [codigos, setCodigos] = useState<Codigo[]>([]);
  const [nota, setNota] = useState('');
  const [dias, setDias] = useState('14');
  const [nuevo, setNuevo] = useState<{ codigo: string; nota: string; dias: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('operador_codigos');
    if (error) setError(error.message);
    else setCodigos((data ?? []) as Codigo[]);
  }, []);

  useEffect(() => {
    void supabase.rpc('operador_codigos').then(({ data, error }) => {
      if (error) setError(error.message);
      else setCodigos((data ?? []) as Codigo[]);
    });
  }, []);

  async function generar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const d = Number(dias);
    if (!Number.isInteger(d) || d < 1 || d > 90) return setError('La validez va de 1 a 90 días.');
    const { data, error } = await supabase.rpc('operador_crear_codigo', { p_nota: nota.trim() || undefined, p_dias: d });
    if (error) return setError(error.message);
    setNuevo({ codigo: data as string, nota: nota.trim(), dias: d });
    setNota('');
    await cargar();
  }

  async function anular(c: Codigo) {
    if (!confirm(`¿Anular el código${c.nota ? ` de "${c.nota}"` : ''}? Ya no se va a poder usar.`)) return;
    setError(null);
    const { error } = await supabase.rpc('operador_anular_codigo', { p_codigo_id: c.id });
    if (error) setError(error.message);
    await cargar();
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black">Códigos de alta</h2>
      <p className="mt-1 text-stone-600">Un código por local nuevo. Sirve una sola vez.</p>
      <form onSubmit={generar} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1 font-medium">
          Para quién (nota)
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={200}
            placeholder="Pizzería Don José"
            className="rounded-lg border-2 border-stone-300 px-3 py-2 text-lg"
          />
        </label>
        <label className="flex w-28 flex-col gap-1 font-medium">
          Vence en
          <span className="flex items-center gap-1">
            <input
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              inputMode="numeric"
              className="w-16 rounded-lg border-2 border-stone-300 px-3 py-2 text-lg"
            />
            días
          </span>
        </label>
        <button type="submit" className="rounded-lg bg-stone-900 px-4 py-3 font-bold text-white">
          Generar código
        </button>
      </form>
      {error && (
        <div className="mt-3">
          <MensajeError>{error}</MensajeError>
        </div>
      )}
      {nuevo && <CodigoNuevo key={nuevo.codigo} {...nuevo} />}

      {codigos.length > 0 && (
        <ul className="mt-4 divide-y divide-stone-200">
          {codigos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-40 flex-1 font-medium">{c.nota ?? <span className="text-stone-400">Sin nota</span>}</span>
              <span className="text-sm text-stone-500">creado {fecha(c.created_at)}</span>
              {c.estado === 'usado' && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-bold text-emerald-800">
                  Usado{c.negocio ? ` · ${c.negocio}` : ''}
                </span>
              )}
              {c.estado === 'vencido' && (
                <span className="rounded-full bg-stone-200 px-2 py-0.5 text-sm font-bold text-stone-600">Vencido</span>
              )}
              {c.estado === 'vigente' && (
                <>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-sm font-bold text-indigo-800">
                    Vigente hasta {fecha(c.vence_at)}
                  </span>
                  <button type="button" onClick={() => void anular(c)} className="text-sm font-medium text-red-700 underline">
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

/** El código se ve una sola vez (la base guarda solo su hash): se comparte en el momento. */
function CodigoNuevo({ codigo, nota, dias }: { codigo: string; nota: string; dias: number }) {
  const [copiado, setCopiado] = useState(false);
  const link = `${window.location.origin}/registro?codigo=${codigo}`;
  const texto = `Hola${nota ? ` ${nota}` : ''}! Para dar de alta tu local en Anotado entrá acá: ${link} (el código es ${codigo} y vence en ${dias} días).`;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4">
      <p className="font-bold text-emerald-900">Código listo{nota ? ` para ${nota}` : ''}</p>
      <p className="text-center font-mono text-2xl font-black tracking-wider">{codigo}</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(texto)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white"
        >
          Mandar por WhatsApp
        </a>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(link).then(() => setCopiado(true))}
          className="rounded-xl border-2 border-emerald-600 px-4 py-3 font-bold text-emerald-800"
        >
          {copiado ? 'Copiado' : 'Copiar link'}
        </button>
      </div>
      <p className="text-sm text-emerald-900">Guardalo ahora: no se puede volver a ver. Si se pierde, anulalo y generá otro.</p>
    </div>
  );
}

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
};

function Locales() {
  const [locales, setLocales] = useState<Local[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('operador_locales');
    if (error) setError(error.message);
    else setLocales((data ?? []) as Local[]);
  }, []);

  useEffect(() => {
    void supabase.rpc('operador_locales').then(({ data, error }) => {
      if (error) setError(error.message);
      else setLocales((data ?? []) as Local[]);
    });
  }, []);

  async function accion(llamada: PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    const { error } = await llamada;
    if (error) setError(error.message);
    await cargar();
  }

  function suspender(l: Local) {
    const motivo = prompt(`¿Suspender "${l.nombre}"? Su gente no va a poder entrar. Motivo (opcional):`);
    if (motivo === null) return;
    void accion(supabase.rpc('operador_cambiar_activo', { p_negocio_id: l.id, p_activo: false, p_motivo: motivo || undefined }));
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black">Locales</h2>
      <p className="mt-1 text-stone-600">Pedidos y usos de IA de los últimos 30 días. Nada de lo que hay adentro de cada local.</p>
      {error && (
        <div className="mt-3">
          <MensajeError>{error}</MensajeError>
        </div>
      )}
      {!locales ? (
        <Cargando />
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {locales.map((l) => (
            <li key={l.id} className={`rounded-xl border-2 p-4 ${l.activo ? 'border-stone-200' : 'border-red-300 bg-red-50'}`}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-lg font-black">{l.nombre}</span>
                <span className="text-sm text-stone-500">/{l.slug} · alta {fecha(l.created_at)}</span>
                {!l.activo && <span className="rounded-full bg-red-600 px-2 py-0.5 text-sm font-bold text-white">Suspendido</span>}
              </div>
              <p className="mt-1 text-sm break-all text-stone-600">
                Dueño{l.duenos.length === 1 ? '' : 's'}: {l.duenos.join(', ') || '—'} · {l.miembros} persona
                {l.miembros === 1 ? '' : 's'} · {l.pedidos_30d} pedidos · {l.usos_ia_30d} usos de IA
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void accion(supabase.rpc('operador_cambiar_ia', { p_negocio_id: l.id, p_permitida: !l.ia_permitida }))}
                  className={`rounded-lg border-2 px-3 py-2 font-bold ${
                    l.ia_permitida ? 'border-emerald-600 text-emerald-700' : 'border-stone-400 text-stone-600'
                  }`}
                >
                  IA {l.ia_permitida ? 'habilitada' : 'sin habilitar'}
                  {l.ia_permitida && !l.ia_activa ? ' (el dueño la apagó)' : ''}
                </button>
                {l.activo ? (
                  <button type="button" onClick={() => suspender(l)} className="rounded-lg px-3 py-2 font-medium text-red-700 underline">
                    Suspender
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void accion(supabase.rpc('operador_cambiar_activo', { p_negocio_id: l.id, p_activo: true }))}
                    className="rounded-lg bg-stone-900 px-3 py-2 font-bold text-white"
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
