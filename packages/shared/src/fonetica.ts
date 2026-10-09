// Comparar palabras "por cómo suenan", para los mensajes escritos rápido desde el celular.
//
// Es la red de seguridad de la IA: si marcó algo como dudoso ("virra"), se compara con los
// nombres y otros nombres del menú después de llevar los dos a una forma fonética del español
// rioplatense. Solo cuenta si coincide la frase entera con UN producto: nada de parecidos
// aproximados, que agregarían cosas que el cliente no pidió.

/**
 * Forma fonética: sin tildes, b=v, s=z=c(e,i), k=c=qu, sin h muda, sin letras repetidas y sin
 * plurales. ll, y y l van juntas: "poyo" es pollo y "musarela" es muzzarella.
 */
export function fonetica(texto: string): string {
  const base = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zñ0-9 ]+/g, ' ');
  return base
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) =>
      palabra
        .replace(/ch/g, 'X') // la ch se protege para no perderla con la h muda
        .replace(/h/g, '')
        .replace(/qu(?=[ei])/g, 'k')
        .replace(/gu(?=[ei])/g, 'g')
        .replace(/c(?=[ei])/g, 's')
        .replace(/c/g, 'k')
        .replace(/z/g, 's')
        .replace(/v/g, 'b')
        .replace(/ll|y/g, 'l')
        .replace(/X/g, 'ch')
        .replace(/(.)\1+/g, '$1')
        .replace(/(?<=[a-zñ]{3})e?s$/, ''),
    )
    .join(' ');
}

const NUMEROS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };

/** "2 virras" → { cantidad: 2, resto: "virras" }. Sin número adelante, 1. */
export function separarCantidad(texto: string): { cantidad: number; resto: string } {
  const m = /^\s*(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis)\s+(.+)$/i.exec(texto.trim());
  if (!m) return { cantidad: 1, resto: texto.trim() };
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUMEROS[m[1]!.toLowerCase()]!;
  return { cantidad: n, resto: m[2]! };
}
