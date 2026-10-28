import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import PresentationSettingsPanel from '../PresentationSettingsPanel';
import { listStyles } from '../presentation-client';
import type { PresentationStyle } from '../types';

let mockWorkspace = 'workspace-one';
let mockUser = { uid: 'user-one' };
jest.mock('@/components/app/app.hooks', () => ({ useCurrentWorkspaceId: () => mockWorkspace }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => mockUser }));
jest.mock('../presentation-client', () => ({ listStyles: jest.fn() }));
jest.mock('../usePresentationAccess', () => ({
  usePresentationAccess: () => ({ canManageStyles: true, isLoading: false, hasError: false }),
}));
jest.mock('../StyleSettings', () => ({
  __esModule: true,
  default: ({ styles }: { styles: PresentationStyle[] }) => (
    <div data-testid='styles'>{styles.map((style) => style.name).join(', ')}</div>
  ),
}));
jest.mock('../PromptAdministration', () => ({
  __esModule: true,
  default: ({ workspaceId }: { workspaceId: string }) => <div>Administrator request: {workspaceId}</div>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkspace = 'workspace-one';
  mockUser = { uid: 'user-one' };
});

it('loads the authenticated workspace catalog and mounts administration only on explicit request', async () => {
  jest.mocked(listStyles).mockResolvedValue([{ name: 'Server company style' } as PresentationStyle]);
  render(<PresentationSettingsPanel />);
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
  const view = render(<PresentationSettingsPanel />);
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
  render(<PresentationSettingsPanel />);
  await screen.findByText('Access denied');
  expect(screen.queryByTestId('styles')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByTestId('styles');
  expect(listStyles).toHaveBeenCalledTimes(2);
});
