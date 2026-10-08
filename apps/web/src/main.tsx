import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import './index.css';
import { PantallaMensaje } from './components/Estado.tsx';
import { RequiereSesion } from './components/RequiereSesion.tsx';
import { SesionProvider } from './components/SesionProvider.tsx';
import { SoloRoles } from './components/SoloRoles.tsx';
import { AdminAjustes } from './routes/AdminAjustes.tsx';
import { AdminEquipo } from './routes/AdminEquipo.tsx';
import { AdminMenu } from './routes/AdminMenu.tsx';
import { Bienvenida } from './routes/Bienvenida.tsx';
import { Cocina } from './routes/Cocina.tsx';
import { Demo } from './routes/Demo.tsx';
import { Inicio } from './routes/Inicio.tsx';
import { Invitacion } from './routes/Invitacion.tsx';
import { Login } from './routes/Login.tsx';
import { Mostrador } from './routes/Mostrador.tsx';
import { Operador } from './routes/Operador.tsx';
import { Privacidad } from './routes/Privacidad.tsx';
import { InicioNegocio, NegocioLayout } from './routes/NegocioLayout.tsx';
import { Registro } from './routes/Registro.tsx';
import { Simulador } from './routes/Simulador.tsx';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  // Pública: la pide Meta para publicar la app de WhatsApp y la leen los clientes de los locales.
  { path: '/privacidad', element: <Privacidad /> },
  // Pública: la demo para probar sin cuenta (crea una cuenta de demo que dura un día).
  { path: '/demo', element: <Demo /> },
  // Sin sesión obligatoria: quien llega con un código o una invitación todavía no tiene cuenta.
  { path: '/registro', element: <Registro /> },
  { path: '/invitacion/:token', element: <Invitacion /> },
  // Destino de los links del mail (cuenta nueva, contraseña olvidada): toma la sesión del link.
  { path: '/bienvenida', element: <Bienvenida /> },
  {
    element: <RequiereSesion />,
    children: [
      { path: '/', element: <Inicio /> },
      // Panel del operador de Anotado. La base exige operador + código del celular.
      { path: '/operador', element: <Operador /> },
      {
        path: '/:negocio',
        element: <NegocioLayout />,
        children: [
          { index: true, element: <InicioNegocio /> },
          {
            path: 'mostrador',
            element: (
              <SoloRoles roles={['dueno', 'cajero']}>
                <Mostrador />
              </SoloRoles>
            ),
          },
          {
            // Solo en locales de demo: teléfono del cliente, mostrador y cocina juntos.
            path: 'simulador',
            element: (
              <SoloRoles roles={['dueno', 'cajero']}>
                <Simulador />
              </SoloRoles>
            ),
          },
          {
            path: 'cocina',
            element: (
              <SoloRoles roles={['dueno', 'cocina']}>
                <Cocina />
              </SoloRoles>
            ),
          },
          {
            path: 'admin/menu',
            element: (
              <SoloRoles roles={['dueno']}>
                <AdminMenu />
              </SoloRoles>
            ),
          },
          {
            path: 'admin/equipo',
            element: (
              <SoloRoles roles={['dueno']}>
                <AdminEquipo />
              </SoloRoles>
            ),
          },
          {
            path: 'admin/ajustes',
            element: (
              <SoloRoles roles={['dueno']}>
                <AdminAjustes />
              </SoloRoles>
            ),
          },
        ],
      },
    ],
  },
  { path: '*', element: <PantallaMensaje titulo="Página no encontrada" /> },
]);

const root = document.getElementById('root');
if (!root) throw new Error('Falta #root en index.html');

createRoot(root).render(
  <StrictMode>
    <SesionProvider>
      <RouterProvider router={router} />
    </SesionProvider>
  </StrictMode>,
);
