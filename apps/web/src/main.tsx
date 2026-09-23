import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import './index.css';
import { PantallaMensaje } from './components/Estado.tsx';
import { RequiereSesion } from './components/RequiereSesion.tsx';
import { SesionProvider } from './components/SesionProvider.tsx';
import { SoloRoles } from './components/SoloRoles.tsx';
import { AdminMenu } from './routes/AdminMenu.tsx';
import { Inicio } from './routes/Inicio.tsx';
import { Login } from './routes/Login.tsx';
import { Mostrador } from './routes/Mostrador.tsx';
import { InicioNegocio, NegocioLayout } from './routes/NegocioLayout.tsx';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    element: <RequiereSesion />,
    children: [
      { path: '/', element: <Inicio /> },
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
            path: 'admin/menu',
            element: (
              <SoloRoles roles={['dueno']}>
                <AdminMenu />
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
