import { z } from 'zod';
import { MAX_ACCIONES } from './reglas.ts';

// Lo que devuelve la IA. Los productos van por referencia corta del menú del prompt
// (p1, p2…), no por uuid: los modelos chicos copian mal los ids largos. El servidor traduce.
//
// Los campos opcionales son `nullable` y no `optional` para que el JSON Schema sea
// compatible con el modo estricto de salida estructurada (todos los campos requeridos).
// Los rangos (cantidad 1–20, etc.) NO se validan acá: una cantidad absurda no invalida toda
// la respuesta, la rechaza el reducer para esa acción y se lo muestra al cajero.

export const AccionIASchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('agregar'),
    producto: z.string(),
    cantidad: z.int(),
    notas: z.string().nullable(),
  }),
  z.object({
    tipo: z.literal('quitar'),
    producto: z.string(),
  }),
  z.object({
    tipo: z.literal('modificar'),
    producto: z.string(),
    cantidad: z.int().nullable(),
    notas: z.string().nullable(),
  }),
  z.object({
    tipo: z.literal('entrega'),
    modo: z.enum(['retiro', 'delivery', 'mesa']),
    direccion: z.string().nullable(),
    mesa: z.string().nullable(),
  }),
  z.object({
    tipo: z.literal('dudoso'),
    texto_original: z.string(),
  }),
  z.object({
    tipo: z.literal('aclarar'),
    pregunta: z.string(),
  }),
]);

export const RespuestaIASchema = z.object({
  acciones: z.array(AccionIASchema).max(MAX_ACCIONES),
  listo_para_confirmar: z.boolean(),
});

export type AccionIA = z.infer<typeof AccionIASchema>;
export type RespuestaIA = z.infer<typeof RespuestaIASchema>;
