import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import MainAppRoutes from '../MainAppRoutes';

jest.mock('@/i18n/config', () => ({}));
jest.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
jest.mock('@/utils/link-preview-remote', () => ({ registerAppflowyLinkPreviewProvider: jest.fn() }));
// The real wrapper mounts theme, config and snackbars; the routes only need a Suspense boundary.
jest.mock('@/components/main/withAppWrapper', () => {
  const { Suspense } = jest.requireActual<typeof import('react')>('react');

  return {
    __esModule: true,
    default: (Component: React.FC) =>
      function MockAppWrapper() {
        return (
          <Suspense fallback={null}>
            <Component />
          </Suspense>
        );
      },
  };
});
jest.mock('@/pages/McpAuthorizePage', () => ({
  __esModule: true,
  default: () => <div data-testid='mcp-authorize-route' />,
}));
jest.mock('@/pages/McpSetupPage', () => ({ __esModule: true, default: () => <div data-testid='mcp-setup-route' /> }));
jest.mock('@/pages/PublishPage', () => ({ __esModule: true, default: () => <div data-testid='publish-route' /> }));
jest.mock('@/components/error/NotFound', () => ({
  __esModule: true,
  default: () => <div data-testid='not-found-route' />,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <MainAppRoutes />
    </MemoryRouter>
  );
}

describe('MCP routes', () => {
  it('serves the consent page at /oauth/mcp/authorize', async () => {
    renderAt('/oauth/mcp/authorize?client_id=dcr-1&response_type=code');

    expect(await screen.findByTestId('mcp-authorize-route')).toBeTruthy();
    expect(screen.queryByTestId('publish-route')).toBeNull();
  });

  it('serves the public setup page at /oauth/mcp/setup', async () => {
    renderAt('/oauth/mcp/setup');

    expect(await screen.findByTestId('mcp-setup-route')).toBeTruthy();
    expect(screen.queryByTestId('publish-route')).toBeNull();
  });

  it('has no other /oauth/mcp pages', async () => {
    renderAt('/oauth/mcp/unknown');

    expect(await screen.findByTestId('not-found-route')).toBeTruthy();
  });
});
