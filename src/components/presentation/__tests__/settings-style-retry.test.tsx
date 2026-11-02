import { fireEvent, render, screen } from '@testing-library/react';

import { listStyles } from '../presentation-client';
import PresentationSettingsPanel from '../PresentationSettingsPanel';

let mockWorkspace = 'workspace-one';
const mockAdministrationMounts: string[] = [];

jest.mock('@/components/app/app.hooks', () => ({ useCurrentWorkspaceId: () => mockWorkspace }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: 'user-one' }) }));
jest.mock('../presentation-client', () => ({ listStyles: jest.fn() }));
jest.mock('../usePresentationAccess', () => ({
  usePresentationAccess: () => ({ canManageStyles: true, isLoading: false, hasError: false }),
}));
jest.mock('../StyleSettings', () => ({ __esModule: true, default: () => <div data-testid='styles' /> }));
jest.mock('../PromptAdministration', () => {
  const { useEffect, useState } = jest.requireActual<typeof import('react')>('react');

  return {
    __esModule: true,
    default: function MockPromptAdministration({ workspaceId }: { workspaceId: string }) {
      const [draft, setDraft] = useState('');

      useEffect(() => {
        mockAdministrationMounts.push(workspaceId);
      }, [workspaceId]);
      return <input aria-label='Unsaved prompt text' value={draft} onChange={(event) => setDraft(event.target.value)} />;
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkspace = 'workspace-one';
  mockAdministrationMounts.length = 0;
});

test('retrying company styles keeps prompt administration open with its unsaved text', async () => {
  jest.mocked(listStyles).mockRejectedValueOnce(new Error('Styles are unavailable')).mockResolvedValueOnce([]);
  render(<PresentationSettingsPanel />);
  await screen.findByText('Styles are unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Prompt administration' }));
  const draft = await screen.findByLabelText<HTMLInputElement>('Unsaved prompt text');

  fireEvent.change(draft, { target: { value: 'Draft component text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByTestId('styles');
  expect(listStyles).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('Unsaved prompt text')).toBe(draft);
  expect(draft.value).toBe('Draft component text');
});

test('closes prompt administration for another workspace before it renders there', async () => {
  jest.mocked(listStyles).mockResolvedValue([]);
  const view = render(<PresentationSettingsPanel />);

  fireEvent.click(screen.getByRole('button', { name: 'Prompt administration' }));
  await screen.findByLabelText('Unsaved prompt text');
  mockWorkspace = 'workspace-two';
  view.rerender(<PresentationSettingsPanel />);
  expect(screen.queryByLabelText('Unsaved prompt text')).toBeNull();
  expect(screen.getByRole('button', { name: 'Prompt administration' })).toBeTruthy();
  expect(mockAdministrationMounts).toEqual(['workspace-one']);
  await screen.findByTestId('styles');
});
