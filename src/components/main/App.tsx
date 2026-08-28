import '@/styles/app.scss';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

const FormPage = lazy(() => import('@/pages/FormPage'));
const MainAppRoutes = lazy(() => import('@/components/main/MainAppRoutes'));

function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <ErrorBoundary FallbackComponent={RouteError}>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path='/form/:token' element={<FormPage />} />
            <Route path='*' element={<MainAppRoutes />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

function RouteError() {
  return (
    <div className='fixed inset-0 flex flex-col items-center justify-center gap-3 bg-background-primary px-6 text-center'>
      <h1 className='text-xl font-semibold'>Couldn’t load this page</h1>
      <p className='text-sm text-text-caption'>Please reload and try again.</p>
      <button
        type='button'
        className='rounded-md bg-fill-default px-3 py-2 text-sm font-medium text-white'
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}

function RouteLoading() {
  return (
    <div
      role='status'
      aria-label='Loading page'
      className='fixed inset-0 flex items-center justify-center bg-background-primary'
    >
      <span className='text-text-caption'>Loading…</span>
    </div>
  );
}

export default App;
