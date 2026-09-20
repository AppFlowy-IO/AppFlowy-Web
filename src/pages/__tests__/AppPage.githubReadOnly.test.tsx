import { act, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { getPageSource, GithubPageSource } from '@/application/services/domains/github-sync';
import { AccessLevel, Types, View, ViewLayout, YDocWithMeta } from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import AppPage from '../AppPage';

const mockView: View = {
  view_id: 'github-document',
  name: 'GitHub documentation',
  icon: null,
  layout: ViewLayout.Document,
  extra: null,
  children: [],
  is_published: false,
  is_private: false,
};
const mockOutline = [mockView];
const mockNoop = jest.fn();
const mockLoadView = jest.fn();
const mockRenderedDocumentProps = jest.fn();
const mockPermission = {
  object_id: mockView.view_id,
  collab_type: Types.Document,
  governing_view_id: mockView.view_id,
  access_level: AccessLevel.FullAccess,
  can_read: true,
  can_write: true,
  can_comment: true,
  can_share: true,
};

jest.mock('@/components/app/app.hooks', () => ({
  useAppViewId: () => mockView.view_id,
  useAIEnabled: () => true,
  useCurrentWorkspaceId: () => 'workspace',
  useAppOutline: () => mockOutline,
  useAppOperations: () => ({
    loadView: mockLoadView,
    toView: mockNoop,
    loadViewMeta: mockNoop,
    createRow: mockNoop,
    updatePage: mockNoop,
    addPage: mockNoop,
    deletePage: mockNoop,
    setWordCount: mockNoop,
    uploadFile: mockNoop,
  }),
  useAppRendered: () => false,
  useAppendBreadcrumb: () => mockNoop,
  useOnRendered: () => mockNoop,
  useOpenPageModal: () => mockNoop,
  useLoadViews: () => mockNoop,
  useEventEmitter: () => undefined,
  useGetMentionUser: () => mockNoop,
  useLoadDatabaseRelations: () => mockNoop,
  useScheduleDeferredCleanup: () => mockNoop,
}));

jest.mock('@/components/app/hooks/useViewObjectPermission', () => ({
  INITIAL_VIEW_OBJECT_CAPABILITIES: { can_read: true, can_write: false, can_comment: false, can_share: false },
  useViewObjectPermission: () => mockPermission,
}));

jest.mock('@/components/app/hooks/useViewOperations', () => ({
  getViewReadOnlyStatus: () => false,
  getViewCanCommentStatus: () => true,
  getViewCanWriteStatus: () => true,
}));

jest.mock('@/components/main/app.hooks', () => ({
  AFConfigContext: jest.requireActual<typeof import('react')>('react').createContext(undefined),
  useCurrentUser: () => ({ email: 'test@appflowy.io' }),
}));

jest.mock('@/application/services/domains', () => ({
  ViewService: { get: jest.fn() },
  WorkspaceService: { searchMentions: jest.fn() },
}));
jest.mock('@/application/services/domains/github-sync', () => ({ getPageSource: jest.fn() }));
jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => null }));
jest.mock('@/components/app/DatabaseView', () => () => null);
jest.mock('@/components/document', () => ({
  Document: (props: { doc: Y.Doc; readOnly: boolean; canWrite: boolean }) => {
    mockRenderedDocumentProps(props);
    return <div data-testid='page-doc'>{props.doc.guid}</div>;
  },
}));
jest.mock('@/components/ai-chat', () => ({ AIChat: () => null }));
jest.mock('@/components/_shared/help/Help', () => () => null);
jest.mock('@/components/error/RecordNotFound', () => () => null);
jest.mock('@/components/_shared/helmet/ViewHelmet', () => () => null);
jest.mock('@/components/app/RevertedDialog', () => ({ RevertedDialog: () => null }));

const fetchSource = getPageSource as jest.MockedFunction<typeof getPageSource>;
const managedSource: GithubPageSource = {
  binding_id: 'binding',
  view_id: mockView.view_id,
  read_only: true,
  status: 'synced',
  paused: false,
  path: 'docs/AUTHENTICATION.md',
  lifecycle: 'active',
  source_url: 'https://github.com/example/docs/blob/main/docs/AUTHENTICATION.md',
  source_commit_sha: 'abc123',
  last_error: null,
};

function renderPage() {
  return render(
    <AFConfigContext.Provider
      value={{
        isAuthenticated: true,
        authenticatedUserId: 'test-user',
        updateCurrentUser: mockNoop,
        openLoginModal: mockNoop,
      }}
    >
      <AppPage />
    </AFConfigContext.Provider>
  );
}

function expectDocumentEditing(enabled: boolean) {
  expect(mockRenderedDocumentProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ readOnly: !enabled, canWrite: enabled })
  );
}

describe('AppPage GitHub document editing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchSource.mockReset();
    const doc = new Y.Doc({ guid: 'cached-doc' }) as YDocWithMeta;

    doc.view_id = mockView.view_id;
    mockLoadView.mockResolvedValue(doc);
  });

  it('keeps the cached document read-only until its source is resolved, then retains GitHub ownership', async () => {
    let resolveSource!: (source: GithubPageSource | null) => void;

    fetchSource.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSource = resolve;
        })
    );
    renderPage();

    await screen.findByText('cached-doc');
    expectDocumentEditing(false);
    await act(async () => resolveSource(managedSource));
    expectDocumentEditing(false);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(mockRenderedDocumentProps.mock.calls.every(([props]) => props.readOnly && !props.canWrite)).toBe(true);
  });

  it('enables editing for an ordinary page only after the source lookup confirms it is unmanaged', async () => {
    let resolveSource!: (source: GithubPageSource | null) => void;

    fetchSource.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSource = resolve;
        })
    );
    renderPage();

    await screen.findByText('cached-doc');
    expectDocumentEditing(false);
    await act(async () => resolveSource(null));
    await waitFor(() => expectDocumentEditing(true));
  });

  it.each([
    { label: 'syncing', status: 'syncing' as const, paused: false },
    { label: 'paused', status: 'synced' as const, paused: true },
    { label: 'failed', status: 'sync_failed' as const, paused: false },
    { label: 'disconnected', status: 'connection_issue' as const, paused: false },
  ])('keeps a $label GitHub page read-only despite cached write permission', async ({ status, paused }) => {
    fetchSource.mockResolvedValue({ ...managedSource, status, paused });
    renderPage();

    await screen.findByText('cached-doc');
    await waitFor(() => expect(fetchSource).toHaveBeenCalledTimes(1));
    expectDocumentEditing(false);
  });

  it('keeps editing disabled if the initial ownership request fails', async () => {
    let rejectSource!: (reason: unknown) => void;

    fetchSource.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSource = reject;
        })
    );
    renderPage();

    await screen.findByText('cached-doc');
    expectDocumentEditing(false);
    await act(async () => rejectSource({ httpStatus: 503 }));
    expectDocumentEditing(false);
    expect(mockRenderedDocumentProps.mock.calls.every(([props]) => props.readOnly && !props.canWrite)).toBe(true);
  });
});
