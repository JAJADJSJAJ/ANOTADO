import { ZonasEnvio } from '../components/ZonasEnvio.tsx';
import { useNegocio } from '../hooks/useNegocio.ts';
import { Encabezado } from './AdminLayout.tsx';

/** Zonas de envío con su costo: el cajero elige una en cada delivery. */
export function AdminEnvios() {
  const negocio = useNegocio();
  return (
    <>
      <Encabezado titulo="Envíos">
        En un delivery, el cajero elige la zona y el costo se suma al total. Los cambios se guardan solos.
      </Encabezado>
      <ZonasEnvio negocioId={negocio.id} />
    </>
  );
}
