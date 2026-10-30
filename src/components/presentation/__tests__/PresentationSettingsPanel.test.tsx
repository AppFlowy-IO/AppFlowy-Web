import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { listStyles } from '../presentation-client';
import PresentationSettingsPanel from '../PresentationSettingsPanel';
import { getPresentationStatus } from '../server-client';

import type { PresentationStatus } from '../server-contract';
import type { PresentationStyle } from '../types';
import type { ReactNode } from 'react';

let mockWorkspace = 'workspace-one';
let mockUser = { uid: 'user-one' };

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => mockWorkspace,
  useUserWorkspaceInfo: () => ({ workspaces: [{ id: mockWorkspace, owner: mockUser }] }),
}));
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useIsOfficialHosted: () => false }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => mockUser }));
jest.mock('../presentation-client', () => ({
  listStyles: jest.fn(),
  getPresentationStatus: jest.requireMock('../server-client').getPresentationStatus,
  entitlementForStatus: jest.requireActual('../server-adapter').entitlementForStatus,
}));
jest.mock('../server-client', () => ({ getPresentationStatus: jest.fn() }));
jest.mock('../StyleSettings', () => ({
  __esModule: true,
  default: ({ styles, maxTemplateBytes }: { styles: PresentationStyle[]; maxTemplateBytes?: number | null }) => (
    <div data-testid='styles' data-max-template-bytes={maxTemplateBytes === null ? 'unlimited' : maxTemplateBytes}>{styles.map((style) => style.name).join(', ')}</div>
  ),
}));
jest.mock('../PromptAdministration', () => ({
  __esModule: true,
  default: ({ workspaceId }: { workspaceId: string }) => <div>Administrator request: {workspaceId}</div>,
}));

const status: PresentationStatus = {
  schemaVersion: 1,
  promptBundleVersion: 'bundle',
  plan: 'free',
  usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 },
  remainingSlides: 12,
  themes: [],
  slideSchemas: [1],
  maxSlides: 12,
  maxTemplateBytes: 5 * 1024 * 1024,
  aiResponses: { metered: false },
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listStyles).mockReset().mockResolvedValue([]);
  jest.mocked(getPresentationStatus).mockReset().mockResolvedValue(status);
  mockWorkspace = 'workspace-one';
  mockUser = { uid: 'user-one' };
});

it('passes the paid upload allowance to settings and keeps saved styles readable during a status outage', async () => {
  jest.mocked(listStyles).mockResolvedValue([]);
  jest.mocked(getPresentationStatus).mockResolvedValueOnce({ ...status, plan: 'paid', maxTemplateBytes: 50 * 1024 * 1024 });
  const view = render(<PresentationSettingsPanel />, { wrapper });

  await waitFor(() => expect(screen.getByTestId('styles').getAttribute('data-max-template-bytes')).toBe(String(50 * 1024 * 1024)));
  jest.mocked(getPresentationStatus).mockRejectedValueOnce(new Error('Gateway unavailable'));
  mockWorkspace = 'workspace-two';
  view.rerender(<PresentationSettingsPanel />);
  await waitFor(() => expect(screen.getByTestId('styles').getAttribute('data-max-template-bytes')).toBe(String(5 * 1024 * 1024)));
  expect(getPresentationStatus).toHaveBeenCalledTimes(2);
});

it('passes explicit unlimited self-host allowance without replacing it with the paid cap', async () => {
  jest.mocked(listStyles).mockResolvedValue([]);
  jest.mocked(getPresentationStatus).mockResolvedValueOnce({ ...status, plan: 'paid', maxTemplateBytes: null });
  render(<PresentationSettingsPanel />, { wrapper });
  expect((await screen.findByTestId('styles')).getAttribute('data-max-template-bytes')).toBe('unlimited');
});

it('loads the authenticated workspace catalog and mounts administration only on explicit request', async () => {
  jest.mocked(listStyles).mockResolvedValue([{ name: 'Server company style' } as PresentationStyle]);
  render(<PresentationSettingsPanel />, { wrapper });
  await screen.findByText('Server company style');
  expect(listStyles).toHaveBeenCalledWith({ workspaceId: 'workspace-one' }, expect.any(AbortSignal));
  expect(screen.queryByText(/Administrator request/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Prompt administration' }));
  await screen.findByText('Administrator request: workspace-one');
});

it('aborts stale workspace reads and prevents the previous account catalog from flashing after identity changes', async () => {
  const pending: Array<{ signal: AbortSignal; finish: (styles: PresentationStyle[]) => void }> = [];

  jest
    .mocked(listStyles)
    .mockImplementation((_scope, signal) => new Promise((finish) => pending.push({ signal: signal!, finish })));
  const view = render(<PresentationSettingsPanel />, { wrapper });

  expect(pending).toHaveLength(1);
  mockWorkspace = 'workspace-two';
  view.rerender(<PresentationSettingsPanel />);
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => pending[0].finish([{ name: 'Old private style' } as PresentationStyle]));
  expect(screen.queryByText('Old private style')).toBeNull();
  await act(async () => pending[1].finish([{ name: 'New workspace style' } as PresentationStyle]));
  await screen.findByText('New workspace style');
  mockUser = { uid: 'user-two' };
  view.rerender(<PresentationSettingsPanel />);
  expect(screen.queryByText('New workspace style')).toBeNull();
  await waitFor(() => expect(pending).toHaveLength(3));
});

it('shows a failed catalog request explicitly and retries without a local fallback', async () => {
  jest.mocked(listStyles).mockRejectedValueOnce(new Error('Access denied')).mockResolvedValueOnce([]);
  render(<PresentationSettingsPanel />, { wrapper });
  await screen.findByText('Access denied');
  expect(screen.queryByTestId('styles')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByTestId('styles');
  expect(listStyles).toHaveBeenCalledTimes(2);
});

it('renders styles while one shared status read is pending and adopts its upload limit when it arrives', async () => {
  let finish!: (value: PresentationStatus) => void;

  jest.mocked(getPresentationStatus).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  jest.mocked(listStyles).mockResolvedValue([{ name: 'Server company style' } as PresentationStyle]);
  render(<PresentationSettingsPanel />, { wrapper });

  await screen.findByText('Server company style');
  expect(screen.getByTestId('styles').getAttribute('data-max-template-bytes')).toBe(String(5 * 1024 * 1024));
  expect(getPresentationStatus).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ...status, plan: 'paid', maxTemplateBytes: null }));
  expect(screen.getByTestId('styles').getAttribute('data-max-template-bytes')).toBe('unlimited');
  expect(getPresentationStatus).toHaveBeenCalledTimes(1);
});
