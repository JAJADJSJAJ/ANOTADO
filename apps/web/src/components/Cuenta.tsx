import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Logo } from './Marca.tsx';

// Piezas de las pantallas sin local: entrar, registrarse y aceptar una invitación.

/** Fondo con la marca arriba y una tarjeta blanca abajo. */
export function PantallaCuenta({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-indigo-50 to-stone-100 p-4">
      <div className="text-center">
        <Logo className="mx-auto size-14" />
        <h1 className="mt-3 text-4xl font-black tracking-tight">Anotado</h1>
        <p className="mt-1 text-lg text-stone-600">Los pedidos de WhatsApp, anotados solos.</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white p-6 shadow-xl shadow-indigo-900/5">
        {children}
      </div>
    </main>
  );
}

export function Campo({
  etiqueta,
  ayuda,
  ...input
}: { etiqueta: string; ayuda?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 font-medium">
      {etiqueta}
      <input
        {...input}
        className="rounded-xl border-2 border-stone-300 px-3 py-3 text-lg outline-none focus:border-indigo-500"
      />
      {ayuda && <span className="text-sm font-normal text-stone-500">{ayuda}</span>}
    </label>
  );
}

export function BotonPrincipal({ children, ...boton }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      {...boton}
      className="rounded-xl bg-indigo-600 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/20 active:bg-indigo-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Después de pedir la cuenta: falta abrir el mail para elegir la contraseña. */
export function MailEnviado({ email, onOtroMail }: { email: string; onOtroMail: () => void }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <h2 className="text-xl font-black">Revisá tu mail</h2>
      <p className="text-lg text-stone-700">
        Te mandamos un link a <strong className="break-all">{email}</strong>. Abrilo para confirmar el mail y elegir tu
        contraseña. Después seguís desde donde quedaste.
      </p>
      <p className="text-stone-600">Si en unos minutos no llegó, mirá en Spam o pedilo de nuevo.</p>
      <button type="button" onClick={onOtroMail} className="self-start font-medium text-indigo-700 underline">
        Pedirlo de nuevo o usar otro mail
      </button>
    </div>
  );
}
