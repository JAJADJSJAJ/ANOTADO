import { type CSSProperties, Fragment } from 'react';

/**
 * Texto que entra letra por letra girando en 3D (rotateX desde -90°, desde atrás en Z, con
 * resorte). Se arma por palabras (cada una inline-block sin cortes) para que el renglón se
 * parta igual que un texto normal. El lector de pantalla lee el texto entero de un sr-only;
 * las letras van aria-hidden (aria-label en un span sin rol no lo leen todos). Con menos movimiento la animación dura 1ms (regla global de index.css).
 * Va adentro del h1/h2: <h1><Letras3D texto="..." /></h1>.
 */
export function Letras3D({ texto, retardo = 0, paso = 22 }: { texto: string; retardo?: number; paso?: number }) {
  const palabras = texto.split(' ');
  let i = 0;
  return (
    // key: si cambia el texto, la entrada vuelve a correr.
    <span key={texto} className="letras-3d">
      <span className="sr-only">{texto}</span>
      {palabras.map((p, n) => (
        <Fragment key={n}>
        <span aria-hidden className="letras-3d-palabra">
          {Array.from(p).map((l, k) => (
            <span key={k} className="letras-3d-letra" style={{ '--i': i++, '--retardo': `${retardo}ms`, '--paso': `${paso}ms` } as CSSProperties}>
              {l}
            </span>
          ))}
        </span>
        {n < palabras.length - 1 && <span aria-hidden> </span>}
        </Fragment>
      ))}
    </span>
  );
}
