import type { SVGProps } from 'react';

/**
 * Íconos de trazo, dibujados para Anotado (sin librería): 24×24, trazo 1.8, puntas redondas.
 * Heredan el color del texto. Son decorativos: el botón que los usa lleva su texto o aria-label.
 */
const TRAZOS = {
  mas: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  cerrar: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  flecha: <path d="M5 12h13M13 6l6 6-6 6" />,
  volver: <path d="M19 12H6M11 6l-6 6 6 6" />,
  abajo: <path d="m7 10 5 5 5-5" />,
  derecha: <path d="m10 7 5 5-5 5" />,
  alerta: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </>
  ),
  sonido: (
    <>
      <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
    </>
  ),
  silencio: (
    <>
      <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
      <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
    </>
  ),
  salir: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10" />,
  ajustes: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  ticket: (
    <>
      <path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21z" />
      <path d="M9 8h6M9 11.5h4" />
    </>
  ),
  menu: (
    <>
      <path d="M5 5h14v14H5z" />
      <path d="M8.5 9h7M8.5 12h7M8.5 15h4" />
    </>
  ),
  equipo: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.8a3 3 0 0 1 0 5.4M17 14.2a5.5 5.5 0 0 1 3.5 4.8" />
    </>
  ),
  reloj: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  moto: (
    <>
      <circle cx="6" cy="16.5" r="2.5" />
      <circle cx="18" cy="16.5" r="2.5" />
      <path d="M8.5 16.5h6l2-6H13M16.5 10.5 15 6h-2.5M3.5 13l3-3h4l2 3" />
    </>
  ),
  cocina: (
    <>
      <path d="M5 11h14v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" />
      <path d="M3 11h18M9 7.5c0-1 1-1.5 1-2.5M13.5 7.5c0-1 1-1.5 1-2.5" />
    </>
  ),
  chispa: <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5" />,
  copiar: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  enviar: <path d="M5 12h13M13 6l6 6-6 6" />,
  mensaje: <path d="M4.5 18.5 6 15a7.5 7.5 0 1 1 3 3z" />,
  pantalla: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  llave: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.5 12.5 19 4M16 7l2.5 2.5M14 9l1.5 1.5" />
    </>
  ),
  tienda: (
    <>
      <path d="M4 9.5 5.5 4.5h13L20 9.5M4 9.5h16v2a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0 2.7 2.7 0 0 1-5.3 0z" />
      <path d="M5.5 13v6.5h13V13M10 19.5v-4h4v4" />
    </>
  ),
  ubicacion: (
    <>
      <path d="M12 20.5s-6-5.4-6-10.5a6 6 0 0 1 12 0c0 5.1-6 10.5-6 10.5z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  lapiz: <path d="M4.5 19.5 5.5 15 15.5 5a2.1 2.1 0 0 1 3 3l-10 10zM13.5 7l3 3" />,
  pausa: <path d="M9 6.5v11M15 6.5v11" />,
  ojo: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
} as const;

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, className = 'size-[18px]', ...svg }: { nombre: NombreIcono } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={`shrink-0 ${className}`}
      {...svg}
    >
      {TRAZOS[nombre]}
    </svg>
  );
}
