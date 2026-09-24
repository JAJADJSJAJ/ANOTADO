/** Logo de Anotado: una comanda con un tilde. */
export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect x="4" y="2" width="24" height="28" rx="6" fill="#4f46e5" />
      <path d="M9 10h14M9 15h9" stroke="#c7d2fe" strokeWidth="2.5" strokeLinecap="round" />
      <path d="m11 21.5 3.5 3.5 7-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Marca({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-black tracking-tight ${className}`}>
      <Logo />
      Anotado
    </span>
  );
}
