import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ErrorPage } from '../ErrorPage';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useServerHostingMode: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../LandingPage', () => ({
  __esModule: true,
  default: ({ title, description }: { title: React.ReactNode; description: React.ReactNode }) => (
    <main><h1>{title}</h1>{description}</main>
  ),
}));

it('keeps diagnostics hidden until the user copies support details', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<ErrorPage error={{
    code: 1073, sourceDomain: 'appflowy.server', httpStatus: 400,
    message: 'SQLSTATE: private export diagnostic', requestId: 'export-123',
  }} />);

  expect(screen.getByText('Other exports are in progress. Wait for one to finish.')).toBeTruthy();
  expect(screen.queryByText(/SQLSTATE/)).toBeNull();
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('copy error'));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = writeText.mock.calls[0][0];

  expect(copied).toContain('SQLSTATE: private export diagnostic');
  expect(copied).toContain('1073');
  expect(copied).toContain('Reference: export-123');
});
