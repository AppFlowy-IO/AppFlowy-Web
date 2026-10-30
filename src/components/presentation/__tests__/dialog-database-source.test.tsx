import { fireEvent, render, screen } from '@testing-library/react';

import PresentationDialog from '../PresentationDialog';
import { sourceToSnapshot } from '../server-adapter';

import { cellId, databaseSource } from './fixtures/database-source';

import type { PageSnapshot } from '../types';

const mockToView = jest.fn().mockResolvedValue(undefined);
let mockSnapshot = sourceToSnapshot(databaseSource);
const mockOperations = { toView: mockToView, loadView: jest.fn(), loadRowDocument: jest.fn() };

jest.mock('@/components/app/app.hooks', () => ({
  useAppView: () => undefined, useCurrentWorkspaceId: () => 'workspace', useAppOperations: () => mockOperations,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: 'user' }) }));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: () => ({ canRead: true, canWrite: true, hasLoadedViewActionPermissions: true }),
}));
jest.mock('../usePresentationAccess', () => ({ usePresentationAccess: () => ({}) }));
jest.mock('../presentation-client', () => ({ loadSourceSnapshot: async () => mockSnapshot }));
jest.mock('../PresentationShell', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('../presentation-preload', () => ({
  loadDocumentPresenter: async () => ({ default: () => null }),
  loadPresentationStudio: async () => ({ default: ({ onSource }: { onSource: (id: string, source: PageSnapshot) => void }) =>
    <button onClick={() => onSource(cellId, mockSnapshot)}>Open cited row</button> }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshot = sourceToSnapshot(databaseSource);
});

test.each(['mindmap', 'slides'] as const)('%s opens the cited row through its database view, not the parent document', async (mode) => {
  const close = jest.fn();

  render(<PresentationDialog viewId='page' mode={mode} onClose={close} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open cited row' }));
  expect(mockToView).toHaveBeenCalledWith('embedded-view', 'row-id');
  expect(close).toHaveBeenCalledTimes(1);
});

test('does not guess a navigation target for missing or unrelated database evidence', async () => {
  mockSnapshot = sourceToSnapshot({ ...databaseSource, databaseViews: databaseSource.databaseViews.map((view) => ({ ...view, databaseId: 'another-database' })) });
  const close = jest.fn();

  render(<PresentationDialog viewId='page' mode='mindmap' onClose={close} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open cited row' }));
  expect(mockToView).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
