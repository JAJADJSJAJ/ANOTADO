import type { Tables } from '@anotado/shared';
import { useCallback, useEffect, useState } from 'react';
import { Cargando, MensajeError } from '../components/Estado.tsx';
import { Compartir } from '../components/Compartir.tsx';
import { Icono } from '../components/Icono.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { useSesion } from '../hooks/useSesion.ts';
import { NOMBRE_ROL, type Rol } from '../lib/contextos.ts';
import { usePreguntar } from '../lib/dialogos.ts';
import { efecto } from '../lib/sonido.ts';
import { supabase } from '../lib/supabase.ts';
import { Bloque, Encabezado } from './AdminLayout.tsx';

type Miembro = { user_id: string; email: string; rol: Rol };
type InvitacionPendiente = Pick<Tables<'invitaciones'>, 'id' | 'rol' | 'vence_at'>;
type LinkNuevo = { rol: Rol; url: string };

const ROLES: Rol[] = ['cajero', 'cocina', 'dueno'];
const QUE_HACE: Record<Rol, string> = {
  dueno: 'Todo: menú, equipo, ajustes y pedidos.',
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
  const preguntar = usePreguntar();
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
    if (error) {
      efecto('error');
      setError(error.message);
    }
    await cargar();
  }

  async function invitar(rol: Rol) {
    setError(null);
    const { data, error } = await supabase.rpc('crear_invitacion', { p_negocio_id: negocio.id, p_rol: rol });
    if (error) return setError(error.message);
    efecto('imprimir');
    setLink({ rol, url: `${window.location.origin}/invitacion/${(data as { token: string }).token}` });
    await cargar();
  }

  async function cambiarRol(m: Miembro, rol: Rol) {
    if (m.user_id === yo && rol !== 'dueno') {
      const ok = await preguntar({
        titulo: '¿Dejar de ser dueño?',
        texto: 'No vas a poder volver a Administrar. Otro dueño te puede devolver el rol.',
        aceptar: 'Cambiar mi rol',
        peligro: true,
      });
      if (ok === null) return;
    }
    // Si me cambio a mí, la barra y los permisos de la pantalla tienen que enterarse.
    await cambiar(supabase.rpc('cambiar_rol', { p_negocio_id: negocio.id, p_user_id: m.user_id, p_rol: rol }));
    if (m.user_id === yo) negocio.recargar();
  }

  async function sacar(m: Miembro) {
    const ok = await preguntar({
      titulo: m.user_id === yo ? '¿Salir del local?' : `¿Sacar a ${m.email}?`,
      texto: 'Pierde el acceso al instante.',
      aceptar: m.user_id === yo ? 'Salir del local' : 'Sacar',
      peligro: true,
    });
    if (ok === null) return;
    await cambiar(supabase.rpc('quitar_miembro', { p_negocio_id: negocio.id, p_user_id: m.user_id }));
    if (m.user_id === yo) negocio.recargar();
  }

  if (!miembros && !error) return <Cargando />;

  return (
    <>
      <Encabezado titulo="Equipo">Quién entra al local y qué puede hacer cada uno.</Encabezado>
      <div className="flex flex-col gap-4">
        {error && <MensajeError>{error}</MensajeError>}

        <Bloque titulo="Invitar a alguien" descripcion="Elegí el rol y mandale el link. Sirve una sola vez y vence en 48 horas.">
          <div className="grid gap-2 sm:grid-cols-3">
            {ROLES.map((rol) => (
              <button
                key={rol}
                type="button"
                onClick={() => void invitar(rol)}
                data-sonido="no"
                className="group flex flex-col items-start gap-1 rounded-xl border border-linea-fuerte p-3.5 text-left transition-[border-color,background-color,transform] duration-150 hover:border-tinta hover:bg-papel/60 active:scale-[0.98]"
              >
                <span className="flex w-full items-center justify-between font-semibold">
                  {NOMBRE_ROL[rol]}
                  <Icono nombre="mas" className="size-4 text-tinta-3 transition-colors group-hover:text-tinta" />
                </span>
                <span className="text-sm text-tinta-2">{QUE_HACE[rol]}</span>
              </button>
            ))}
          </div>
          {link && <LinkInvitacion key={link.url} link={link} negocio={negocio.nombre} />}
        </Bloque>

        <Bloque titulo="Personas">
          <ul className="-my-2 divide-y divide-linea">
            {miembros?.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
                <span aria-hidden className="grid size-8 place-items-center rounded-full bg-papel text-sm font-bold text-tinta-2">
                  {m.email.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-40 flex-1 truncate font-medium">
                  {m.email}
                  {m.user_id === yo && <span className="ml-2 text-sm font-normal text-tinta-3">vos</span>}
                </span>
                <select
                  value={m.rol}
                  aria-label={`Rol de ${m.email}`}
                  onChange={(e) => void cambiarRol(m, e.target.value as Rol)}
                  className="campo campo-chico w-32"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {NOMBRE_ROL[r]}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-quitar btn-chico" onClick={() => void sacar(m)}>
                  Sacar
                </button>
              </li>
            ))}
          </ul>
        </Bloque>

        {pendientes.length > 0 && (
          <Bloque titulo="Links sin usar">
            <ul className="-my-2 divide-y divide-linea">
              {pendientes.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-3">
                  <span className="flex-1">
                    <span className="font-semibold">{NOMBRE_ROL[i.rol]}</span>
                    <span className="ml-2 text-sm text-tinta-3">
                      vence {new Date(i.vence_at).toLocaleString('es-UY', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-quitar btn-chico"
                    onClick={() => void cambiar(supabase.rpc('revocar_invitacion', { p_invitacion_id: i.id }))}
                  >
                    Anular
                  </button>
                </li>
              ))}
            </ul>
          </Bloque>
        )}
      </div>
    </>
  );
}

/** El link se ve una sola vez (la base guarda solo su hash): se comparte en el momento. */
function LinkInvitacion({ link, negocio }: { link: LinkNuevo; negocio: string }) {
  const texto = `Te invito a ${negocio} en Anotado como ${NOMBRE_ROL[link.rol].toLowerCase()}: ${link.url}`;
  return (
    <Compartir
      titulo={`Link para ${NOMBRE_ROL[link.rol].toLowerCase()}`}
      valor={link.url}
      textoWhatsApp={texto}
      aviso="Guardalo ahora: por seguridad no se puede volver a ver. Si se pierde, anulalo y creá otro."
    />
  );
}
