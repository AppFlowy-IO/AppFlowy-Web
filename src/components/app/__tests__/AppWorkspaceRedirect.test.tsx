import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { UserWorkspaceInfo } from '@/application/types';
import { AppWorkspaceRedirect } from '@/components/app/AppWorkspaceRedirect';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';

function LocationProbe() {
  const location = useLocation();

  return <div data-testid='location'>{`${location.pathname}${location.search}`}</div>;
}

function renderAt(entry: string) {
  const context: AuthInternalContextType = {
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: { selectedWorkspace: { id: 'workspace-1' } } as unknown as UserWorkspaceInfo,
  };

  return render(
    <AuthInternalContext.Provider value={context}>
      <MemoryRouter initialEntries={[entry]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes>
          <Route path='/app' element={<AppWorkspaceRedirect />} />
          <Route path='/app/:workspaceId' element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthInternalContext.Provider>
  );
}

describe('AppWorkspaceRedirect', () => {
  it('keeps the query string so settings deep links survive the redirect', async () => {
    renderAt('/app?setting=AI_APPS');

    expect((await screen.findByTestId('location')).textContent).toBe('/app/workspace-1?setting=AI_APPS');
  });

  it('redirects a bare /app to the selected workspace', async () => {
    renderAt('/app');

    expect((await screen.findByTestId('location')).textContent).toBe('/app/workspace-1');
  });
});
