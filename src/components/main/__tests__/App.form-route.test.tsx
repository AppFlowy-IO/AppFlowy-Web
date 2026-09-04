import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { FormOrPublishedRoute } from '../App';

jest.mock('@/styles/app.scss', () => ({}));

let mockFormApiNotFound = false;

jest.mock('@/pages/FormPage', () => ({
  __esModule: true,
  default: ({ notFoundFallback }: { notFoundFallback?: React.ReactNode }) =>
    mockFormApiNotFound ? notFoundFallback : <div data-testid='public-form-route' />,
}));

jest.mock('@/components/main/MainAppRoutes', () => ({
  __esModule: true,
  default: () => <div data-testid='published-page-route' />,
}));

function renderRoute(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Suspense fallback={<div>Loading</div>}>
        <Routes>
          <Route path='/form/:token' element={<FormOrPublishedRoute />} />
        </Routes>
      </Suspense>
    </MemoryRouter>
  );
}

describe('Form route compatibility', () => {
  beforeEach(() => {
    mockFormApiNotFound = false;
  });

  it('keeps ordinary slugs in the existing form publish namespace', async () => {
    renderRoute('/form/existing-published-page');

    expect(await screen.findByTestId('published-page-route')).toBeTruthy();
    expect(screen.queryByTestId('public-form-route')).toBeNull();
  });

  it('routes UUID share tokens to the public Form page', async () => {
    renderRoute('/form/c6c31f9b-c334-4e3a-be20-79f661d4ad87');

    expect(await screen.findByTestId('public-form-route')).toBeTruthy();
    expect(screen.queryByTestId('published-page-route')).toBeNull();
  });

  it('hands a UUID-shaped publish slug to the publish route only after Form 404', async () => {
    mockFormApiNotFound = true;

    renderRoute('/form/c6c31f9b-c334-4e3a-be20-79f661d4ad87');

    expect(await screen.findByTestId('published-page-route')).toBeTruthy();
    expect(screen.queryByTestId('public-form-route')).toBeNull();
  });
});
