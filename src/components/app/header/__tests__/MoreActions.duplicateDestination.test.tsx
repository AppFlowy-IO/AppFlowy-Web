import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { ViewLayout, type View } from '@/application/types';

import MoreActions from '../MoreActions';

const mockPage: View = { view_id: 'page', name: 'Onboarding', layout: ViewLayout.Document, icon: null,
  extra: null, children: [], is_private: false, is_published: false, parent_view_id: 'hr' };
const mockSpace: View = { view_id: 'hr', name: 'HR', layout: ViewLayout.Document, icon: null,
  extra: { is_space: true }, children: [mockPage], is_private: false, is_published: false };
let mockParentAcceptsPages = false;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams('')] }));
jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => false, useAppViewId: () => 'page', useDatabaseHistoryEnabled: () => false,
  useAppView: (id?: string) => (id === 'page' ? mockPage : id === 'hr' ? mockSpace : undefined),
  useCurrentWorkspaceId: () => 'workspace', useEventEmitter: () => undefined, usePageHistoryEnabled: () => false,
}));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  // The page is editable; its parent space only accepts pages from its owners unless granted.
  useViewActionPermissions: jest.fn((view?: View) => ({
    canWrite: true,
    canCreateViewActions: view?.view_id === 'hr' ? mockParentAcceptsPages : true,
    canManageViewActions: false,
    canUsePageHistory: false,
    hasLoadedViewActionPermissions: true,
    isLoadingViewActionPermissions: false,
  })),
}));
jest.mock('@/components/app/contexts/SyncInternalContext', () => ({ useSyncInternalOptional: () => undefined }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: 'user' }) }));
jest.mock('@/components/ai-chat/AIChatProvider', () => ({ useAIChatContext: () => ({}) }));
jest.mock('@/application/services/domains', () => ({ AIService: {} }));
jest.mock('@/application/services/domains/view', () => ({ getDatabaseIdFromWorkspaceCatalog: jest.fn() }));
jest.mock('../DocumentInfo', () => () => null);
jest.mock('../MoreActionsContent', () => ({
  __esModule: true,
  default: ({ canDuplicateActions }: { canDuplicateActions: boolean }) =>
    <div data-testid='more-actions-content'>{canDuplicateActions ? 'duplicate' : 'no-duplicate'}</div>,
}));
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) =>
    <div><button onClick={() => onOpenChange(true)}>Open menu</button>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  mockParentAcceptsPages = false;
});

test('the page header menu hides Duplicate when the parent space does not accept new pages', () => {
  render(<MoreActions viewId='page' />);
  fireEvent.click(screen.getByText('Open menu'));
  expect(screen.getByTestId('more-actions-content').textContent).toBe('no-duplicate');
});

test('the page header menu offers Duplicate when the parent space accepts new pages', () => {
  mockParentAcceptsPages = true;
  render(<MoreActions viewId='page' />);
  fireEvent.click(screen.getByText('Open menu'));
  expect(screen.getByTestId('more-actions-content').textContent).toBe('duplicate');
});
