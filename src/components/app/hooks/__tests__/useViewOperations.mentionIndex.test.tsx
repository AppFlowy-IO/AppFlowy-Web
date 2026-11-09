import EventEmitter from 'events';

import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { WorkspaceService } from '@/application/services/domains';
import { Types, View, ViewExtra, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';
import {
  clearMentionLocalIndex,
  getMentionLocalSnapshot,
  setMentionIndexSources,
} from '@/components/editor/components/panels/mention-panel/mentionLocalIndex';

import { useViewOperations } from '../useViewOperations';

const mockOpenView = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));

jest.mock('@/application/services/domains', () => ({
  CollabService: {},
  ViewService: { get: jest.fn() },
  WorkspaceService: { addRecentPages: jest.fn() },
}));

jest.mock('@/application/view-loader', () => ({
  openView: (...args: unknown[]) => mockOpenView(...args),
}));

jest.mock('../useDatabaseIdentity', () => ({
  useDatabaseIdentity: () => ({
    resolveCollabObjectId: async (_doc: unknown, viewId: string) => viewId,
    getDatabaseIdForViewId: jest.fn(),
    getViewIdFromDatabaseId: jest.fn(),
  }),
}));

const WORKSPACE_ID = 'workspace-a';

function view(viewId: string, overrides: Partial<View> = {}): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

const outline = [
  view('space', {
    is_space: true,
    children: [
      view('roadmap'),
      view('notes'),
      view('chat', { layout: ViewLayout.AIChat }),
      view('tasks', {
        layout: ViewLayout.Grid,
        extra: { is_database_container: true, database_id: 'db-1' } as ViewExtra,
        children: [view('tasks-grid', { layout: ViewLayout.Grid, extra: { database_id: 'db-1' } as ViewExtra })],
      }),
    ],
  }),
];

function Wrapper({ children }: { children: ReactNode }) {
  const auth: AuthInternalContextType = {
    currentWorkspaceId: WORKSPACE_ID,
    isAuthenticated: true,
    onChangeWorkspace: () => Promise.resolve(),
  };
  const sync = {
    registerSyncContext: jest.fn(),
    eventEmitter: new EventEmitter(),
    awarenessMap: {},
  } as unknown as SyncInternalContextType;

  return (
    <AuthInternalContext.Provider value={auth}>
      <SyncInternalContext.Provider value={sync}>{children}</SyncInternalContext.Provider>
    </AuthInternalContext.Provider>
  );
}

function openedAt(viewId: string) {
  return getMentionLocalSnapshot(WORKSPACE_ID).viewsById.get(viewId)?.sessionOpenedAt;
}

describe('useViewOperations and the mention picker’s local candidates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearMentionLocalIndex();
    setMentionIndexSources(WORKSPACE_ID, { outline });
    jest.mocked(WorkspaceService.addRecentPages).mockResolvedValue(undefined);
    mockOpenView.mockImplementation(async () => ({ doc: new Y.Doc(), fromCache: true, collabType: Types.Document }));
  });

  it('records the open of a page loaded for the user, and not a load in the background', async () => {
    const { result } = renderHook(() => useViewOperations(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.loadView('roadmap', false, true, outline);
      await result.current.loadView('notes', false, false, outline);
    });

    expect(WorkspaceService.addRecentPages).toHaveBeenCalledWith(WORKSPACE_ID, ['roadmap']);
    expect(openedAt('roadmap')).toEqual(expect.any(Number));
    expect(openedAt('notes')).toBeUndefined();
  });

  it('counts opening a database’s first view for the database', async () => {
    const { result } = renderHook(() => useViewOperations(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.loadView('tasks-grid', false, true, outline);
    });

    expect(openedAt('tasks')).toEqual(expect.any(Number));
  });

  it('records no open for an AI chat, which is not loaded as a document', async () => {
    const { result } = renderHook(() => useViewOperations(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.loadView('chat', false, true, outline)).rejects.toThrow();
    });

    expect(WorkspaceService.addRecentPages).not.toHaveBeenCalled();
    expect(openedAt('chat')).toBeUndefined();
  });
});
