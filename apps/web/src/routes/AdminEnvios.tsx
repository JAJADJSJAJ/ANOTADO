import { EsqueletoAdmin } from '../components/Esqueletos.tsx';
import { ZonasEnvio } from '../components/ZonasEnvio.tsx';
import { useCargaMinima } from '../hooks/useCargaMinima.ts';
import { useNegocio } from '../hooks/useNegocio.ts';
import { useZonas } from '../hooks/useZonas.ts';
import { Encabezado } from './AdminLayout.tsx';

/** Zonas de envío con su costo: el cajero elige una en cada delivery. */
export function AdminEnvios() {
  const negocio = useNegocio();
  const zonas = useZonas(negocio.id);
  const listo = useCargaMinima(zonas.cargado);
  if (!listo) return <EsqueletoAdmin forma="envios" filas={3} />;
  return (
    <>
      <Encabezado titulo="Envíos">
        En un delivery, el cajero elige la zona y el costo se suma al total. Los cambios se guardan solos.
      </Encabezado>
      <ZonasEnvio negocioId={negocio.id} datos={zonas} />
    </>
  );
}
