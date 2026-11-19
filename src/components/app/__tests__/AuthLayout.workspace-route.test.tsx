import { render, screen } from '@testing-library/react';
import { MemoryRouter, parsePath, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';

import { AppProvider } from '@/components/app/AppProvider';
import { AuthLayout } from '@/components/app/AuthLayout';

jest.mock('@/components/app/AppProvider', () => ({ AppProvider: jest.fn() }));
jest.mock('@/components/app/MainLayout', () => () => null);
jest.mock('@/components/app/MobileMainLayout', () => () => null);

const workspaceId = '19c1e30c-5da8-4547-bdd1-d499bcd05b71';
const viewId = 'deac5f28-f13b-4fc9-8d50-051969e25caf';

function WorkspaceLocation() {
  const { pathname, search, hash, state } = useLocation();
  const navigation = useNavigationType();

  return <output data-navigation={navigation} data-state={state}>{pathname}{search}{hash}</output>;
}

function openRoute(path: string, state?: string) {
  render(
    <MemoryRouter initialEntries={[{ ...parsePath(path), state }]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
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
  jest.mocked(AppProvider).mockImplementation(WorkspaceLocation);
});

it.each([
  '/app/not-a-workspace-id',
  `/app/undefined/${viewId}`,
  `/app/${workspaceId}/bad-view-id`,
  `/app/${workspaceId}%0A`,
  `/app/${workspaceId}/${viewId}%0A`,
  `/app/{${workspaceId.replace(/-/g, '')}}`,
  `/app/${workspaceId}/urn:uuid:${viewId.replace(/-/g, '')}`,
])(
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
  `/app/${workspaceId}`,
  `/app/${workspaceId}/${viewId}/`,
])('opens %s directly', (path) => {
  openRoute(path);

  expect(screen.getByRole('status').textContent).toBe(path);
  expect(screen.getByRole('status').getAttribute('data-navigation')).toBe('POP');
});

it.each([
  [workspaceId.toUpperCase(), workspaceId],
  [workspaceId.replace(/-/g, ''), workspaceId],
  [`{${workspaceId}}`, workspaceId],
  [`urn:uuid:${workspaceId}`, workspaceId],
  [`${workspaceId}/${viewId.replace(/-/g, '')}`, `${workspaceId}/${viewId}`],
  [`${workspaceId.replace('1', '%31')}/${viewId}`, `${workspaceId}/${viewId}`],
  [`%7B${workspaceId}%7D/urn:uuid:${viewId.toUpperCase()}`, `${workspaceId}/${viewId}`],
])('opens %s at its canonical URL before mounting the workspace', (segments, canonicalSegments) => {
  const suffix = '?setting=AI_APPS#connections';

  openRoute(`/app/${segments}${suffix}`, 'from-settings');

  const location = screen.getByRole('status');

  expect(location.textContent).toBe(`/app/${canonicalSegments}${suffix}`);
  expect(location.getAttribute('data-navigation')).toBe('REPLACE');
  expect(location.getAttribute('data-state')).toBe('from-settings');
  expect(AppProvider).toHaveBeenCalledTimes(1);
});
