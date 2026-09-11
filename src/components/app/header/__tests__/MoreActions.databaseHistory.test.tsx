// eslint-disable-next-line import/no-unresolved
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { getDatabaseIdFromWorkspaceCatalog } from '@/application/services/domains/view';
import { Types, ViewLayout, type View } from '@/application/types';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';

import MoreActions from '../MoreActions';

let mockEnabled = true;
let mockCanWrite = true;
let mockRowRoute = false;
const mockReload = jest.fn();
const mockContainer = { view_id: 'container', name: 'Database', layout: ViewLayout.Grid,
  extra: { database_id: 'database-object', is_database_container: true } };
const mockChild = { view_id: 'child', name: 'Grid', layout: ViewLayout.Grid,
  extra: { database_id: 'database-object' } };
const mockModalView: View = { view_id: 'modal-view', name: 'Modal database', layout: ViewLayout.Board,
  icon: null, extra: { database_id: 'modal-database', is_space: false }, children: [], is_private: false, is_published: false };
let mockModalInOutline = true;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(mockRowRoute ? 'r=row' : '')] }));
jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => false, useAppViewId: () => 'child', useDatabaseHistoryEnabled: () => mockEnabled,
  useAppView: (id: string) => id === 'child' ? mockChild : id === 'container' ? mockContainer :
    id === 'modal-view' && mockModalInOutline ? mockModalView : undefined,
  useCurrentWorkspaceId: () => 'workspace', useEventEmitter: () => undefined, usePageHistoryEnabled: () => true,
}));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: jest.fn(() => ({ canWrite: mockCanWrite, hasLoadedViewActionPermissions: true })),
}));
jest.mock('@/components/app/contexts/SyncInternalContext', () => ({
  useSyncInternalOptional: () => ({ reloadDatabaseAfterRestore: mockReload }),
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: 'user' }) }));
jest.mock('@/components/ai-chat/AIChatProvider', () => ({ useAIChatContext: () => ({}) }));
jest.mock('@/application/services/domains', () => ({ AIService: {} }));
jest.mock('@/application/services/domains/view', () => ({ getDatabaseIdFromWorkspaceCatalog: jest.fn() }));
jest.mock('../DocumentInfo', () => () => null);
jest.mock('../MoreActionsContent', () => () => null);
jest.mock('@/components/document/history/DocumentHistoryModal', () => () => <div>Document history</div>);
jest.mock('@/components/database/history/DatabaseHistoryModal', () => ({
  __esModule: true,
  default: ({ databaseId, activeViewId }: { databaseId: string; activeViewId: string }) =>
    <div data-testid='database-modal' data-active-view-id={activeViewId}>{databaseId}</div>,
}));
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) =>
    <div><button onClick={() => onOpenChange(true)}>Open menu</button>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...props }: { children: ReactNode; onSelect?: () => void }) =>
    <button {...props} onClick={onSelect}>{children}</button>,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled = true;
  mockCanWrite = true;
  mockRowRoute = false;
  mockModalInOutline = true;
});

test('checks editor permission on the underlying database and opens history for that identity', async () => {
  render(<MoreActions viewId='container' activeViewId='child' />);
  fireEvent.click(screen.getByText('Open menu'));
  fireEvent.click(await screen.findByTestId('more-page-database-history'));
  expect(await screen.findByTestId('database-modal')).toHaveTextContent('database-object');
  expect(useViewActionPermissions).toHaveBeenCalledWith(mockChild, true, 'child', {
    collabObjectId: 'database-object', collabType: Types.Database,
  });
});

test.each(['viewer', 'capability', 'row-page'])('hides database history for %s', (reason) => {
  if (reason === 'viewer') mockCanWrite = false;
  if (reason === 'capability') mockEnabled = false;
  if (reason === 'row-page') mockRowRoute = true;
  render(<MoreActions viewId='container' activeViewId='child' rowId={mockRowRoute ? 'row' : null} />);
  fireEvent.click(screen.getByText('Open menu'));
  expect(screen.queryByTestId('more-page-database-history')).not.toBeInTheDocument();
});

test.each([false, true])('a modal uses its own database while the background row route is %s', async (rowRoute) => {
  // Global navigation still points at database A. The modal owns database B.
  mockRowRoute = rowRoute;
  render(<MoreActions viewId='modal-view' />);
  fireEvent.click(screen.getByText('Open menu'));
  fireEvent.click(await screen.findByTestId('more-page-database-history'));
  expect(await screen.findByTestId('database-modal')).toHaveTextContent('modal-database');
  expect(screen.getByTestId('database-modal')).toHaveAttribute('data-active-view-id', 'modal-view');
  expect(useViewActionPermissions).toHaveBeenCalledWith(mockModalView, true, 'modal-view', {
    collabObjectId: 'modal-database', collabType: Types.Database,
  });
});

test('an off-outline modal becomes available when its fetched metadata arrives', async () => {
  mockModalInOutline = false;
  const { rerender } = render(<MoreActions viewId='modal-view' />);

  fireEvent.click(screen.getByText('Open menu'));
  expect(screen.queryByTestId('more-page-database-history')).not.toBeInTheDocument();
  rerender(<MoreActions viewId='modal-view' viewMetadata={mockModalView} />);
  fireEvent.click(await screen.findByTestId('more-page-database-history'));
  expect(await screen.findByTestId('database-modal')).toHaveTextContent('modal-database');
  expect(useViewActionPermissions).toHaveBeenCalledWith(mockModalView, true, 'modal-view', {
    collabObjectId: 'modal-database', collabType: Types.Database,
  });
});

test('legacy modal catalog lookup uses its effective view rather than the background route', async () => {
  mockModalInOutline = false;
  jest.mocked(getDatabaseIdFromWorkspaceCatalog).mockResolvedValue('legacy-modal-database');
  render(<MoreActions viewId='modal-view' viewMetadata={{ ...mockModalView, extra: null }} />);
  fireEvent.click(screen.getByText('Open menu'));
  fireEvent.click(await screen.findByTestId('more-page-database-history'));
  expect(await screen.findByTestId('database-modal')).toHaveTextContent('legacy-modal-database');
  expect(getDatabaseIdFromWorkspaceCatalog).toHaveBeenCalledWith('workspace', 'modal-view');
});
