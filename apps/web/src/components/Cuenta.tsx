import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { Icono } from './Icono.tsx';
import { Logo, Marca } from './Marca.tsx';

// Piezas de las pantallas sin local: entrar, registrarse, la demo y aceptar una invitación.

/**
 * Pantalla partida: a la izquierda (en pantallas anchas) qué es Anotado, con un mensaje de
 * WhatsApp que se convierte en comanda; a la derecha el formulario.
 */
export function PantallaCuenta({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-tinta p-10 text-white lg:flex xl:p-14">
        <Marca claro className="text-lg" />
        <div className="max-w-md">
          <h1 className="text-[2.75rem] leading-[1.02] font-bold tracking-[-0.035em] xl:text-5xl">
            Los pedidos de WhatsApp, anotados solos.
          </h1>
          <p className="mt-5 max-w-sm text-lg leading-snug text-white/65">
            La IA lee el mensaje y arma el pedido. El mostrador lo revisa, lo confirma y la cocina lo ve al instante.
          </p>
        </div>
        <Ilustracion />
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-8">
        <Link to="/login" className="self-start lg:hidden">
          <Marca />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-10">{children}</div>
        <footer className="flex items-center justify-between gap-4 text-sm text-tinta-3">
          <span className="lg:hidden">Los pedidos de WhatsApp, anotados solos.</span>
          <Link to="/privacidad" className="ml-auto transition-colors hover:text-tinta">
            Privacidad
          </Link>
        </footer>
      </main>
    </div>
  );
}

/** Un mensaje de cliente que entra y, abajo, la comanda que sale impresa. */
function Ilustracion() {
  return (
    <div aria-hidden className="relative max-w-sm select-none">
      <div className="ml-auto w-fit max-w-[18rem] origin-bottom-right animate-burbuja rounded-[10px] rounded-tr-[3px] bg-wa-propio px-3 pt-2 pb-1.5 text-[0.9375rem] leading-snug text-tinta [animation-delay:300ms]">
        Hola! Quiero 2 completas sin tomate y una coca de 1,5
        <span className="num mt-0.5 block text-right text-[0.6875rem] text-[#6f7a70]">21:04</span>
      </div>
      <div className="my-3 flex items-center gap-2 pl-1 text-white/40">
        <Icono nombre="chispa" className="size-4" />
        <span className="rotulo text-white/40">La IA lo anota</span>
      </div>
      <div className="w-64 animate-imprimir [animation-delay:1100ms]">
        <div className="ticket border-t-4 border-t-ok px-4 pt-3.5">
          <div className="flex items-start justify-between">
            <span className="num text-4xl leading-none font-extrabold tracking-[-0.05em]">#42</span>
            <span className="num rounded-md bg-ok-suave px-1.5 py-1 text-xs font-extrabold text-ok">0 min</span>
          </div>
          <p className="num mt-1.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-tinta-2 uppercase">Retira · WhatsApp</p>
          <hr className="my-3 border-t border-dashed border-linea-fuerte" />
          <p className="text-[1.0625rem] leading-tight font-bold">
            <span className="num mr-2">2</span>Completa
          </p>
          <p className="mt-0.5 ml-[1.35rem] text-sm font-semibold text-alerta-tinta">— sin tomate</p>
          <p className="mt-2 text-[1.0625rem] leading-tight font-bold">
            <span className="num mr-2">1</span>Coca-Cola 1,5 L
          </p>
        </div>
      </div>
    </div>
  );
}

/** Título y bajada de un formulario de cuenta. */
export function TituloCuenta({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div>
      <Logo className="mb-6 hidden size-9 lg:block" />
      <h2 className="text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">{titulo}</h2>
      {children && <p className="mt-2 text-tinta-2">{children}</p>}
    </div>
  );
}

export function Campo({
  etiqueta,
  ayuda,
  ...input
}: { etiqueta: string; ayuda?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      <input {...input} className={`campo h-12 ${input.className ?? ''}`} />
      {ayuda && <span className="mt-1.5 block text-sm text-tinta-3">{ayuda}</span>}
    </label>
  );
}

export function BotonPrincipal({ children, className = 'btn-tinta', ...boton }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="submit" {...boton} className={`btn btn-grande w-full ${className}`}>
      {children}
    </button>
  );
}

/** Separador con texto en el medio ("o"). */
export function Separador({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-tinta-3">
      <span className="h-px flex-1 bg-linea" />
      {children}
      <span className="h-px flex-1 bg-linea" />
    </div>
  );
}

/** Después de pedir la cuenta: falta abrir el mail para elegir la contraseña. */
export function MailEnviado({ email, onOtroMail }: { email: string; onOtroMail: () => void }) {
  return (
    <div role="status" className="flex animate-entra flex-col gap-4">
      <span className="grid size-12 place-items-center rounded-full bg-ok-suave text-ok">
        <Icono nombre="mensaje" className="size-6" />
      </span>
      <TituloCuenta titulo="Revisá tu mail">
        Te mandamos un link a <strong className="font-semibold break-all text-tinta">{email}</strong>. Abrilo para confirmar el
        mail y elegir tu contraseña. Después seguís desde donde quedaste.
      </TituloCuenta>
      <p className="text-sm text-tinta-2">
        Si ya tenías cuenta con ese mail, el link te hace entrar directo. Si en unos minutos no llegó, mirá en Spam o pedilo de
        nuevo.
      </p>
      <button type="button" onClick={onOtroMail} className="enlace self-start text-sm">
        Pedirlo de nuevo o usar otro mail
      </button>
    </div>
  );
}
