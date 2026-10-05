import type { Tables } from '@anotado/shared';
import { useCallback, useEffect, useState } from 'react';
import { Cargando, MensajeError } from '../components/Estado.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { useSesion } from '../hooks/useSesion.ts';
import { NOMBRE_ROL, type Rol } from '../lib/contextos.ts';
import { supabase } from '../lib/supabase.ts';

type Miembro = { user_id: string; email: string; rol: Rol };
type InvitacionPendiente = Pick<Tables<'invitaciones'>, 'id' | 'rol' | 'vence_at'>;
type LinkNuevo = { rol: Rol; url: string };

const ROLES: Rol[] = ['cajero', 'cocina', 'dueno'];
const QUE_HACE: Record<Rol, string> = {
  dueno: 'Todo: menú, equipo, ajustes, pedidos.',
  cajero: 'Toma y confirma pedidos, entrega.',
  cocina: 'Ve los pedidos en la pantalla de cocina.',
};

type Equipo = { miembros: Miembro[]; pendientes: InvitacionPendiente[] };

async function cargarEquipo(negocioId: string): Promise<Equipo | string> {
  const [m, i] = await Promise.all([
    supabase.rpc('miembros_negocio', { p_negocio_id: negocioId }),
    supabase
      .from('invitaciones')
      .select('id, rol, vence_at')
      .eq('negocio_id', negocioId)
      .is('usada_at', null)
      .is('revocada_at', null)
      .gt('vence_at', new Date().toISOString())
      .order('created_at'),
  ]);
  const error = m.error ?? i.error;
  return error ? error.message : { miembros: m.data ?? [], pendientes: i.data ?? [] };
}

/** Equipo del local (dueño): roles, quitar gente e invitar por link de WhatsApp. */
export function AdminEquipo() {
  const negocio = useNegocio();
  const yo = useSesion()?.user.id;
  const [miembros, setMiembros] = useState<Miembro[] | null>(null);
  const [pendientes, setPendientes] = useState<InvitacionPendiente[]>([]);
  const [link, setLink] = useState<LinkNuevo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aplicar = useCallback((r: Equipo | string) => {
    if (typeof r === 'string') return setError(r);
    setMiembros(r.miembros);
    setPendientes(r.pendientes);
  }, []);
  const cargar = useCallback(async () => aplicar(await cargarEquipo(negocio.id)), [negocio.id, aplicar]);

  useEffect(() => {
    void cargarEquipo(negocio.id).then(aplicar);
  }, [negocio.id, aplicar]);

  /** Corre una RPC del equipo, muestra el error si falla y recarga. */
  async function cambiar(accion: PromiseLike<{ error: { message: string } | null }>) {
    setError(null);
    const { error } = await accion;
    if (error) setError(error.message);
    await cargar();
  }

  async function invitar(rol: Rol) {
    setError(null);
    const { data, error } = await supabase.rpc('crear_invitacion', { p_negocio_id: negocio.id, p_rol: rol });
    if (error) return setError(error.message);
    setLink({ rol, url: `${window.location.origin}/invitacion/${(data as { token: string }).token}` });
    await cargar();
  }

  if (!miembros && !error) return <Cargando />;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-black">Equipo</h1>
      {error && <MensajeError>{error}</MensajeError>}

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Invitar a alguien</h2>
        <p className="mt-1 text-stone-600">
          Elegí el rol y mandale el link por WhatsApp. Sirve una sola vez y vence en 48 horas.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {ROLES.map((rol) => (
            <button
              key={rol}
              type="button"
              onClick={() => void invitar(rol)}
              className="flex flex-col rounded-xl border-2 border-stone-300 p-3 text-left hover:border-indigo-400"
            >
              <span className="text-lg font-bold">{NOMBRE_ROL[rol]}</span>
              <span className="text-sm text-stone-600">{QUE_HACE[rol]}</span>
            </button>
          ))}
        </div>
        {link && <LinkInvitacion key={link.url} link={link} negocio={negocio.nombre} />}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Personas</h2>
        <ul className="mt-2 divide-y divide-stone-200">
          {miembros?.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-40 flex-1 font-medium break-all">
                {m.email}
                {m.user_id === yo && <span className="ml-2 text-sm text-stone-500">(vos)</span>}
              </span>
              <select
                value={m.rol}
                aria-label={`Rol de ${m.email}`}
                onChange={(e) => {
                  const rol = e.target.value as Rol;
                  if (m.user_id === yo && rol !== 'dueno' && !confirm('Vas a dejar de ser dueño y no vas a poder volver a esta pantalla. ¿Seguro?')) return;
                  // Si me cambio a mí, la barra y los permisos de la pantalla tienen que enterarse.
                  void cambiar(supabase.rpc('cambiar_rol', { p_negocio_id: negocio.id, p_user_id: m.user_id, p_rol: rol })).then(
                    () => m.user_id === yo && negocio.recargar(),
                  );
                }}
                className="rounded-lg border-2 border-stone-300 px-3 py-2 text-lg"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {NOMBRE_ROL[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="font-medium text-red-700 underline"
                onClick={() => {
                  if (!confirm(`¿Sacar a ${m.email} del local? Pierde el acceso al instante.`)) return;
                  void cambiar(supabase.rpc('quitar_miembro', { p_negocio_id: negocio.id, p_user_id: m.user_id })).then(
                    () => m.user_id === yo && negocio.recargar(),
                  );
                }}
              >
                Sacar
              </button>
            </li>
          ))}
        </ul>
      </section>

      {pendientes.length > 0 && (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Links sin usar</h2>
          <ul className="mt-2 divide-y divide-stone-200">
            {pendientes.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3">
                <span className="flex-1">
                  <strong>{NOMBRE_ROL[i.rol]}</strong>
                  <span className="ml-2 text-stone-500">
                    vence {new Date(i.vence_at).toLocaleString('es-UY', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <button
                  type="button"
                  className="font-medium text-red-700 underline"
                  onClick={() => void cambiar(supabase.rpc('revocar_invitacion', { p_invitacion_id: i.id }))}
                >
                  Anular
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** El link se ve una sola vez (la base guarda solo su hash): se comparte en el momento. */
function LinkInvitacion({ link, negocio }: { link: LinkNuevo; negocio: string }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `Te invito a ${negocio} en Anotado como ${NOMBRE_ROL[link.rol].toLowerCase()}: ${link.url}`;

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4">
      <p className="font-bold text-emerald-900">Link para {NOMBRE_ROL[link.rol].toLowerCase()} listo</p>
      <input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Link de invitación" className="rounded-lg border-2 border-emerald-300 bg-white px-3 py-2 text-sm" />
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
          onClick={() => void navigator.clipboard.writeText(link.url).then(() => setCopiado(true))}
          className="rounded-xl border-2 border-emerald-600 px-4 py-3 font-bold text-emerald-800"
        >
          {copiado ? 'Copiado' : 'Copiar link'}
        </button>
      </div>
      <p className="text-sm text-emerald-900">Guardalo ahora: por seguridad no se puede volver a ver. Si se pierde, anulalo y creá otro.</p>
    </div>
  );
}
