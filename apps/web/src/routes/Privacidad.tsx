import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Marca } from '../components/Marca.tsx';

/** Mail de contacto para consultas y pedidos sobre datos personales. */
const CONTACTO = 'anotadoproject@gmail.com';
const ACTUALIZADA = '6 de octubre de 2026';

/**
 * Política de privacidad (Ley 18.331 de Uruguay). Pública, sin sesión: la pide Meta para
 * publicar la app de WhatsApp y la tienen que poder leer los clientes de los locales.
 * La sección #borrar sirve también como "instrucciones para eliminar datos" en Meta.
 */
export function Privacidad() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-linea bg-hoja/95 backdrop-blur-[2px]">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-5">
          <Link to="/login" className="rounded-lg">
            <Marca />
          </Link>
          <Link to="/demo" className="btn btn-fantasma btn-chico ml-auto">
            Probar la demo
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-10 md:grid-cols-[12rem_minmax(0,1fr)] md:py-14">
        <nav aria-label="Secciones" className="hidden md:block">
          <ol className="sticky top-24 flex flex-col gap-0.5 border-l border-linea">
            {SECCIONES.map(([id, titulo]) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px block border-l border-transparent py-1 pl-3.5 text-sm text-tinta-2 transition-colors hover:border-tinta hover:text-tinta">
                  {titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      <article className="flex max-w-2xl animate-entra flex-col gap-9 text-[1.0625rem] leading-relaxed [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:marker:text-tinta-3">
        <header className="flex flex-col gap-3">
          <p className="rotulo">Legal</p>
          <h1 className="text-4xl leading-tight font-bold tracking-[-0.03em]">Política de privacidad</h1>
          <p className="text-tinta-2">Última actualización: {ACTUALIZADA}.</p>
        </header>

        <Seccion titulo="Qué es Anotado" id="que-es">
          <p>
            Anotado es un sistema para locales de comida: recibe los pedidos que los clientes mandan por WhatsApp y los
            ordena para que el local los prepare. Cada local usa Anotado para sus propios clientes. Los datos de esos
            clientes son del local, que es el responsable de su base de datos; Anotado los guarda y los procesa por
            cuenta del local, solo para lo que se explica acá.
          </p>
        </Seccion>

        <Seccion titulo="Qué datos guardamos" id="datos">
          <p className="font-semibold">De las personas que le escriben por WhatsApp a un local que usa Anotado:</p>
          <ul>
            <li>El número de teléfono y el nombre del perfil de WhatsApp.</li>
            <li>
              El texto completo de los mensajes que le mandan al local. De los audios, fotos y otros archivos solo
              guardamos que se mandaron, no el archivo. Si mandan una ubicación, guardamos el punto del mapa.
            </li>
            <li>
              El pedido que se va armando con esos mensajes (lo que propone la inteligencia artificial y lo que corrige el
              local) y el pedido confirmado: productos, cantidades, notas, forma de entrega, dirección de envío y una copia
              de los mensajes que lo originaron.
            </li>
          </ul>
          <p className="font-semibold">De las personas que trabajan en un local y usan Anotado:</p>
          <ul>
            <li>El mail con el que entran, su rol en el local y las acciones que hacen en el sistema.</li>
          </ul>
        </Seccion>

        <Seccion titulo="Para qué los usamos" id="para-que">
          <p>
            Solo para que el local reciba, arme y entregue los pedidos. Un programa de inteligencia artificial lee los
            mensajes de texto y propone el pedido; una persona del local siempre lo revisa y lo confirma.
          </p>
          <p>
            No vendemos ni compartimos los datos para publicidad, no armamos perfiles de las personas y no usamos los
            mensajes para entrenar inteligencia artificial.
          </p>
        </Seccion>

        <Seccion titulo="Quién más los procesa" id="quien">
          <p>Para funcionar, Anotado usa estos servicios, que procesan los datos solo para darnos ese servicio:</p>
          <ul>
            <li>
              <b>Meta (WhatsApp)</b>, Estados Unidos: por donde llegan los mensajes.
            </li>
            <li>
              <b>Supabase</b>, servidores en San Pablo, Brasil: la base de datos, donde se guarda todo lo de arriba.
            </li>
            <li>
              <b>Vercel</b>, Estados Unidos: el sitio web.
            </li>
            <li>
              <b>OpenRouter</b> y los proveedores de inteligencia artificial que usa, Estados Unidos: leen el texto de los
              mensajes para proponer el pedido. Están configurados para no guardarlos ni usarlos para entrenar.
            </li>
            <li>
              <b>Brevo</b>, Francia (Unión Europea): el envío de mails de la cuenta, por ejemplo para elegir la contraseña.
              Recibe solo el mail de quien usa Anotado.
            </li>
          </ul>
          <p>
            Como estos servicios están fuera de Uruguay, los datos se procesan en esos países, solo para lo que se explica
            en esta política.
          </p>
        </Seccion>

        <Seccion titulo="Cuánto tiempo los guardamos" id="cuanto">
          <p>
            Mientras el local use Anotado, como historial de sus pedidos. Hoy no se borran solos con el tiempo: se borran
            cuando el local deja de usar Anotado y lo pide, o cuando una persona pide que se borren sus datos (ver abajo).
          </p>
        </Seccion>

        <Seccion titulo="Tus derechos" id="borrar">
          <p>
            Según la Ley 18.331 de Protección de Datos Personales, podés pedir ver qué datos tuyos hay, corregirlos o
            que se borren. Escribile al local donde hiciste el pedido, o directamente a{' '}
            <a href={`mailto:${CONTACTO}`} className="enlace">
              {CONTACTO}
            </a>{' '}
            con tu número de teléfono y qué querés hacer. Podemos pedirte que confirmes que el número es tuyo.
            Respondemos en un máximo de 5 días hábiles.
          </p>
          <p>
            <b>Si pedís que se borren tus datos</b>, borramos tu número, tu nombre, tus conversaciones y tus mensajes. De
            los pedidos que ya hiciste, el local conserva solo lo necesario para sus cuentas (productos, cantidades,
            totales y fechas), sin tu dirección, tus notas ni tus mensajes.
          </p>
          <p>
            Si no quedás conforme con la respuesta, podés reclamar ante la Unidad Reguladora y de Control de Datos
            Personales (URCDP) de Uruguay.
          </p>
        </Seccion>

        <Seccion titulo="Cambios" id="cambios">
          <p>Si cambia esta política, actualizamos la fecha de arriba.</p>
        </Seccion>
      </article>
      </div>
    </div>
  );
}

/** Índice de la columna izquierda: id de la sección y su título. */
const SECCIONES: [string, string][] = [
  ['que-es', 'Qué es Anotado'],
  ['datos', 'Qué datos guardamos'],
  ['para-que', 'Para qué los usamos'],
  ['quien', 'Quién más los procesa'],
  ['cuanto', 'Cuánto tiempo'],
  ['borrar', 'Tus derechos'],
  ['cambios', 'Cambios'],
];

function Seccion({ titulo, id, children }: { titulo: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-3">
      <h2 className="text-xl font-bold tracking-[-0.015em]">{titulo}</h2>
      {children}
    </section>
  );
}
