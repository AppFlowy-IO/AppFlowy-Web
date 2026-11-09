import { act, renderHook } from '@testing-library/react';
import { type MutableRefObject, type ReactNode } from 'react';

import { PageService } from '@/application/services/domains';
import { CreatePageResponse, Role, View, ViewIconType, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import {
  clearMentionLocalIndex,
  getMentionLocalSnapshot,
  setMentionIndexSources,
} from '@/components/editor/components/panels/mention-panel/mentionLocalIndex';

import { usePageOperations } from '../usePageOperations';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), warning: jest.fn() } }));

jest.mock('@/application/services/domains', () => ({
  BillingService: {},
  FileService: {},
  PageService: { add: jest.fn(), updateName: jest.fn(), update: jest.fn(), moveToTrash: jest.fn(), restore: jest.fn() },
  PublishService: {},
  ViewService: { invalidateCache: jest.fn() },
}));

jest.mock('@/application/services/js-services/cache', () => ({ deleteView: jest.fn() }));
jest.mock('@/application/services/js-services/cached-api', () => ({ clearPublishViewInfoCache: jest.fn() }));
jest.mock('@/application/services/js-services/http/publish-api', () => ({ publishCollabs: jest.fn() }));
jest.mock('@/application/services/js-services/publish-database-data', () => ({ gatherDatabasePublishData: jest.fn() }));

const WORKSPACE_ID = 'workspace-a';
const OTHER_WORKSPACE_ID = 'workspace-b';
let mockWorkspaceId = WORKSPACE_ID;
let mockRole = Role.Owner;

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

function Wrapper({ children }: { children: ReactNode }) {
  const auth: AuthInternalContextType = {
    currentWorkspaceId: mockWorkspaceId,
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: {
      userId: 'user-id',
      selectedWorkspace: { id: mockWorkspaceId, databaseStorageId: 'database-storage-id', role: mockRole },
    } as AuthInternalContextType['userWorkspaceInfo'],
  };

  return <AuthInternalContext.Provider value={auth}>{children}</AuthInternalContext.Provider>;
}

function snapshot() {
  return getMentionLocalSnapshot(WORKSPACE_ID);
}

/** A space with one page; the outline refresh after a mutation never answers. */
function renderOperations() {
  const outline = [
    view('space', { is_space: true, children: [view('roadmap', { name: 'Roadmap', parent_view_id: 'space' })] }),
  ];
  const outlineRef: MutableRefObject<View[] | undefined> = { current: outline };
  const loadOutline = jest.fn(() => new Promise<void>(() => undefined));
  const loadTrash = jest.fn(() => new Promise<void>(() => undefined));
  const ensureViewVisibleInOutline = jest.fn(async () => []);

  setMentionIndexSources(WORKSPACE_ID, { outline });

  const rendered = renderHook(
    () => usePageOperations({ outlineRef, loadOutline, loadTrash, ensureViewVisibleInOutline }),
    { wrapper: Wrapper }
  );

  return { ...rendered, loadOutline };
}

describe('usePageOperations and the mention picker’s local candidates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearMentionLocalIndex();
    mockWorkspaceId = WORKSPACE_ID;
    mockRole = Role.Owner;
  });

  it('lists a page as soon as addPage resolves, while the outline reload is still pending', async () => {
    jest.mocked(PageService.add).mockResolvedValue({ view_id: 'zebra' });
    const { result, loadOutline } = renderOperations();

    await act(async () => {
      await result.current.addPage('space', { layout: ViewLayout.Document, name: 'Zebra plan', page_data: {} });
    });

    expect(loadOutline).toHaveBeenCalledWith(WORKSPACE_ID, false);
    expect(snapshot().viewsById.get('zebra')).toEqual(
      expect.objectContaining({ name: 'Zebra plan', parentViewId: 'space', source: 'session' })
    );
    expect(snapshot().viewsById.get('zebra')?.sessionCreatedAt).toEqual(expect.any(Number));
  });

  // Default creation (no page data) shows the page through the outline before it resolves, which
  // this mocked service skips: the session creation lists it either way.
  it('lists a database created in a space with the database id the server returned', async () => {
    jest.mocked(PageService.add).mockResolvedValue({ view_id: 'bugs', database_id: 'db-bugs' });
    const { result } = renderOperations();

    await act(async () => {
      await result.current.addPage('space', { layout: ViewLayout.Board, name: 'Bugs' });
    });

    expect(snapshot().viewsById.get('bugs')).toEqual(
      expect.objectContaining({ name: 'Bugs', isDatabase: true, databaseId: 'db-bugs' })
    );
  });

  it('records nothing for a creation that failed, or that resolved after a workspace switch', async () => {
    jest.mocked(PageService.add).mockRejectedValueOnce(new Error('quota'));
    const { result, rerender } = renderOperations();
    const before = snapshot();

    await act(async () => {
      await expect(result.current.addPage('space', { layout: ViewLayout.Document, name: 'Lost' })).rejects.toThrow(
        'quota'
      );
    });
    expect(snapshot()).toBe(before);

    let resolveAdd: (value: CreatePageResponse) => void = () => undefined;

    jest.mocked(PageService.add).mockReturnValueOnce(
      new Promise<CreatePageResponse>((resolve) => {
        resolveAdd = resolve;
      })
    );

    let pending: Promise<unknown> = Promise.resolve();

    act(() => {
      pending = result.current.addPage('space', { layout: ViewLayout.Document, name: 'Late' });
    });
    mockWorkspaceId = OTHER_WORKSPACE_ID;
    rerender();
    await act(async () => {
      resolveAdd({ view_id: 'late' });
      await expect(pending).rejects.toThrow('The page creation workspace changed');
    });

    expect(snapshot()).toBe(before);
  });

  it('records nothing when a guest may not create pages', async () => {
    mockRole = Role.Guest;
    const { result } = renderOperations();
    const before = snapshot();

    await expect(result.current.addPage('space', { layout: ViewLayout.Document, name: 'Nope' })).rejects.toThrow();
    expect(PageService.add).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it('shows a rename from updatePageName or updatePage, and ignores an unchanged name', async () => {
    jest.mocked(PageService.updateName).mockResolvedValue(undefined);
    jest.mocked(PageService.update).mockResolvedValue(undefined);
    const { result } = renderOperations();

    await act(async () => {
      await result.current.updatePageName('roadmap', 'Roadmap 2026');
    });
    expect(snapshot().viewsById.get('roadmap')).toEqual(
      expect.objectContaining({ name: 'Roadmap 2026', sessionRenamedAt: expect.any(Number) })
    );

    const afterRename = snapshot();

    // An icon change sends the name the page already shows.
    await act(async () => {
      await result.current.updatePage('roadmap', {
        name: 'Roadmap 2026',
        icon: { ty: ViewIconType.Emoji, value: '🚀' },
      });
    });
    expect(snapshot()).toBe(afterRename);

    await act(async () => {
      await result.current.updatePage('roadmap', { name: 'Roadmap 2027' });
    });
    expect(snapshot().viewsById.get('roadmap')?.name).toBe('Roadmap 2027');
  });

  it('records no rename the server rejected', async () => {
    jest.mocked(PageService.updateName).mockRejectedValue(new Error('denied'));
    const { result } = renderOperations();

    await expect(result.current.updatePageName('roadmap', 'Hijacked')).rejects.toThrow('denied');
    expect(snapshot().viewsById.get('roadmap')?.name).toBe('Roadmap');
  });

  it('drops a page moved to the trash while the outline still lists it, and lists it again on restore', async () => {
    jest.mocked(PageService.moveToTrash).mockResolvedValue(undefined);
    jest.mocked(PageService.restore).mockResolvedValue(undefined);
    const { result } = renderOperations();

    await act(async () => {
      await result.current.deletePage('roadmap');
    });
    expect(snapshot().viewsById.has('roadmap')).toBe(false);

    await act(async () => {
      await result.current.restorePage('roadmap');
    });
    expect(snapshot().viewsById.has('roadmap')).toBe(true);
  });

  it('keeps a page whose move to the trash failed', async () => {
    jest.mocked(PageService.moveToTrash).mockRejectedValue(new Error('denied'));
    const { result } = renderOperations();

    await expect(result.current.deletePage('roadmap')).rejects.toThrow('denied');
    expect(snapshot().viewsById.has('roadmap')).toBe(true);
  });
});
