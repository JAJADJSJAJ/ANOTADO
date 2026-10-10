/**
 * Logo de Anotado: una comanda con el borde de abajo cortado y un tilde de birome.
 * En fondo oscuro (`claro`) el papel pasa a blanco y las líneas a tinta.
 */
export function Logo({ className = 'size-7', claro = false }: { className?: string; claro?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M6 3h20v26l-3.33-2-3.34 2L16 27l-3.33 2-3.34-2L6 29z" fill={claro ? '#fffefa' : '#151513'} />
      <path d="M10.5 11h11M10.5 15.5h7" stroke={claro ? '#151513' : '#fffefa'} strokeWidth="2" strokeLinecap="round" />
      <path
        d="m11.5 21 2.8 2.6 6.2-6.6"
        fill="none"
        stroke={claro ? '#1f3fe0' : '#6f86ff'}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Marca({ className = '', claro = false }: { className?: string; claro?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-extrabold tracking-[-0.02em] ${className}`}>
      <Logo claro={claro} />
      Anotado
    </span>
  );
}
