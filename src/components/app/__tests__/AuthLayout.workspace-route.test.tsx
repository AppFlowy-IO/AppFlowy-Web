import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AppProvider } from '@/components/app/AppProvider';
import { AuthLayout } from '@/components/app/AuthLayout';

jest.mock('@/components/app/AppProvider', () => ({ AppProvider: jest.fn(() => <div>Workspace</div>) }));
jest.mock('@/components/app/MainLayout', () => () => null);
jest.mock('@/components/app/MobileMainLayout', () => () => null);

const workspaceId = '19c1e30c-5da8-4547-bdd1-d499bcd05b71';

function openRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path='/app' element={<></>} />
          <Route path='/app/trash' element={<></>} />
          <Route path='/app/:workspaceId' element={<></>} />
          <Route path='/app/:workspaceId/:viewId' element={<></>} />
        </Route>
        <Route path='/404' element={<div>Page not found</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

it.each(['/app/not-a-workspace-id', `/app/undefined/${workspaceId}`])(
  'rejects %s before starting workspace requests',
  (path) => {
    openRoute(path);

    expect(screen.queryByText('Page not found')).not.toBeNull();
    expect(AppProvider).not.toHaveBeenCalled();
  }
);

it.each([
  '/app',
  '/app/trash',
  `/app/${workspaceId}/${workspaceId}`,
  `/app/${workspaceId.toUpperCase()}`,
  `/app/${workspaceId.replace(/-/g, '')}`,
  `/app/{${workspaceId}}`,
  `/app/urn:uuid:${workspaceId}`,
])('allows the existing workspace route %s', (path) => {
  openRoute(path);

  expect(screen.queryByText('Workspace')).not.toBeNull();
});
