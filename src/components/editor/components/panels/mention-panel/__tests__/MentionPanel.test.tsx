import EventEmitter from 'events';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { emit, EventType } from '@/application/session/event';
import { TOKEN_STORAGE_KEY } from '@/application/session/token-storage';
import { MentionSearchRequest, MentionSearchResponse, MentionTargetKind, View, ViewLayout } from '@/application/types';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import * as runtimeConfig from '@/utils/runtime-config';

import { MentionPanel } from '../MentionPanel';
import { clearMentionSearchCacheForTests } from '../mentionSearchCache';

const mockClosePanel = jest.fn();
const mockRemoveContent = jest.fn();
const mockAddMark = jest.fn();
const mockTranslate = (key: string) => key;
const mockLoadViews = jest.fn();
const mockNotifyPerson = jest.fn();
const mockToastSuccess = jest.fn();
const mockNotifyError = jest.fn();
const mockPanelContext = {
  activePanel: PanelType.PageReference,
  isPanelOpen: (panel: PanelType) => panel === PanelType.PageReference,
  panelPosition: { top: 0, left: 0 },
  searchText: 'Target',
  closePanel: mockClosePanel,
  removeContent: mockRemoveContent,
};
const mockSession = { userId: 'actor', authenticated: true };
const mockEditorContext: Record<string, unknown> = { workspaceId: 'workspace', loadViews: mockLoadViews };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: {} }));
jest.mock('../useNotifyPersonMention', () => ({ useNotifyPersonMention: () => mockNotifyPerson }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { addMark: (...args: unknown[]) => mockAddMark(...args) },
}));
jest.mock('@/components/editor/components/panels/Panels.hooks', () => ({
  usePanelContext: () => mockPanelContext,
}));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => mockEditorContext }));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ uuid: mockSession.userId }),
  useAuthenticatedUserIdOptional: () => mockSession.userId,
  useIsAuthenticatedOptional: () => mockSession.authenticated,
}));
jest.mock('sonner', () => ({ toast: { success: (...args: unknown[]) => mockToastSuccess(...args) } }));
jest.mock('@/components/_shared/notify', () => ({
  notify: { error: (...args: unknown[]) => mockNotifyError(...args) },
}));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid='mention-panel'>{children}</div> : null,
  calculateOptimalOrigins: () => ({ transformOrigin: { vertical: 'top', horizontal: 'left' } }),
}));

const retryLater = { code: ERROR_CODE.RETRY_LATER, message: 'refresh permissions' };
const rowsRetryLater = { code: ERROR_CODE.RETRY_LATER, message: 'refresh permissions', retryAfterSecs: 1 };

function base64Url(value: object) {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sessionToken(sessionId: string, rotation = 0) {
  return JSON.stringify({
    access_token: `${base64Url({ alg: 'HS256' })}.${base64Url({ sub: 'actor', session_id: sessionId, n: rotation })}.sig`,
    refresh_token: `refresh-${sessionId}-${rotation}`,
    expires_at: 4102444800,
    user: { id: 'actor' },
  });
}

const emptyRows = { sections: [{ kind: 'database_rows', items: [], status: 'ready' }] } as MentionSearchResponse;
const isRows = (request: MentionSearchRequest) =>
  request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow;
const pageResponse = (title: string) =>
  ({
    sections: [
      {
        kind: 'pages',
        title: 'Pages',
        items: [
          {
            kind: 'page',
            object_id: title,
            title,
            mention: { type: 'page', page_id: title },
          },
        ],
      },
    ],
  } as MentionSearchResponse);

function mountPanel(emitter = new EventEmitter()) {
  const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });
  const tree = () => (
    <AppEventEmitterContext.Provider value={emitter}>
      <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@Target' }] }]}>
        <Editable data-testid='mounted-editor' />
        <MentionPanel />
      </Slate>
    </AppEventEmitterContext.Provider>
  );
  const rendered = render(tree());

  return { ...rendered, emitter, editor, redraw: () => rendered.rerender(tree()) };
}

describe('MentionPanel composition', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearMentionSearchCacheForTests();
    mockSession.userId = 'actor';
    mockSession.authenticated = true;
    mockEditorContext.workspaceId = 'workspace';
    mockEditorContext.viewId = undefined;
    mockEditorContext.addPage = undefined;
    mockEditorContext.openPageModal = undefined;
    localStorage.clear();
    mockPanelContext.activePanel = PanelType.PageReference;
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.PageReference;
    mockPanelContext.searchText = 'Target';
    mockEditorContext.searchMentions = undefined;
    mockEditorContext.enableReminderMentions = undefined;
    mockLoadViews.mockResolvedValue([{ view_id: 'target-page', name: 'Target', layout: ViewLayout.Document } as View]);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('removes revoked suggestions when the refresh asks to retry later', async () => {
    const emitter = new EventEmitter();
    const search = jest.fn(async (request: MentionSearchRequest) => ({
      sections:
        request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow
          ? [{ kind: 'database_rows', items: [], status: 'ready' }]
          : [
              {
                kind: 'pages',
                title: 'Pages',
                items: [
                  {
                    kind: 'page',
                    object_id: 'target-page',
                    title: 'Target',
                    mention: { type: 'page', page_id: 'target-page' },
                  },
                ],
              },
            ],
    }));

    mockEditorContext.searchMentions = search;
    const editor = withReact(createEditor());

    render(
      <AppEventEmitterContext.Provider value={emitter}>
        <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@Target' }] }]}>
          <Editable />
          <MentionPanel />
        </Slate>
      </AppEventEmitterContext.Provider>
    );
    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    search.mockRejectedValue({ code: ERROR_CODE.RETRY_LATER, message: 'refresh permissions' });
    act(() => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, { viewId: 'target-page' });
    });
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
  });

  it('drops a warm cache on RetryLater even without a permission notification', async () => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel();

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    mockPanelContext.searchText = 'Other';
    panel.redraw();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4));
    search.mockRejectedValue(retryLater);
    mockPanelContext.searchText = 'Target';
    panel.redraw();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(6));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Target' })).toBeNull());
  });

  it('shows a reopened picker\'s suggestions at once within the same access scope, then revalidates', async () => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel();

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    mockPanelContext.isPanelOpen = () => false;
    panel.redraw();
    expect(screen.queryByTestId('mention-panel')).toBeNull();
    search.mockImplementation(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Fresh')
    );
    mockPanelContext.isPanelOpen = (kind) => kind === PanelType.PageReference;
    panel.redraw();
    expect(screen.getByRole('button', { name: 'Target' })).toBeTruthy();
    expect(screen.getByTestId('mention-panel').querySelector('[aria-busy="true"]')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Fresh' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    expect(search).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['keeps', 'a network failure', new Error('Network Error')],
    ['drops', 'a permission denial', { code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'denied' }],
  ])('%s reopened suggestions when the background refresh hits %s', async (outcome, _failure, error) => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel();

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    mockPanelContext.isPanelOpen = () => false;
    panel.redraw();
    search.mockRejectedValue(error);
    mockPanelContext.isPanelOpen = (kind) => kind === PanelType.PageReference;
    panel.redraw();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    if (outcome === 'keeps') {
      expect(screen.getByRole('button', { name: 'Target' })).toBeTruthy();
    } else {
      expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    }
  });

  it('does not reuse suggestions after a permission change while the picker was closed', async () => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel();

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    mockPanelContext.isPanelOpen = () => false;
    panel.redraw();
    act(() => {
      panel.emitter.emit(APP_EVENTS.PERMISSION_CHANGED);
    });
    search.mockRejectedValue(retryLater);
    mockPanelContext.isPanelOpen = (kind) => kind === PanelType.PageReference;
    panel.redraw();
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
  });

  it('coalesces a synchronous permission burst through the ordinary request debounce', async () => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel();

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    search.mockRejectedValue(retryLater);
    act(() => {
      for (let index = 0; index < 100; index += 1) panel.emitter.emit(APP_EVENTS.PERMISSION_CHANGED);
    });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
  });

  it.each([false, true])(
    'does not publish parallel page results after row RetryLater (partial rows first=%s)',
    async (partialFirst) => {
      let rows = 0;
      const search = jest.fn(async (request: MentionSearchRequest) => {
        if (!isRows(request)) return pageResponse('Target');
        rows += 1;
        if (partialFirst && rows === 1) return { ...emptyRows, partial: true };
        if (rows <= (partialFirst ? 2 : 1)) throw rowsRetryLater;
        return emptyRows;
      });

      mockEditorContext.searchMentions = search;
      mountPanel();
      await waitFor(() => expect(rows).toBe(partialFirst ? 2 : 1));
      await act(async () => {
        await Promise.resolve();
      });
      // The page response passed its own check before the change that the row search reports.
      expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
      expect(screen.getByText('document.mention.refreshingSuggestions')).toBeTruthy();
      // After the server's cooldown the whole search runs again and shows fresh results.
      expect(await screen.findByRole('button', { name: 'Target' }, { timeout: 3000 })).toBeTruthy();
      expect(rows).toBe(partialFirst ? 3 : 2);
      expect(screen.queryByText('document.mention.refreshingSuggestions')).toBeNull();
    }
  );

  // A network failure alone keeps cached suggestions; the permission signal must win over it.
  it.each([
    ['succeeds', async () => pageResponse('Target')],
    [
      'fails with a network error',
      async (): Promise<MentionSearchResponse> => {
        throw new Error('Network Error');
      },
    ],
  ])('drops reopened suggestions when only the row refresh reports a permission change (page %s)', async (_page, page) => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel();

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    mockPanelContext.isPanelOpen = () => false;
    panel.redraw();
    search.mockImplementation(async (request: MentionSearchRequest) => {
      if (isRows(request)) throw rowsRetryLater;
      return page();
    });
    mockPanelContext.isPanelOpen = (kind) => kind === PanelType.PageReference;
    panel.redraw();
    expect(screen.getByRole('button', { name: 'Target' })).toBeTruthy();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Target' })).toBeNull());
    expect(screen.getByText('document.mention.refreshingSuggestions')).toBeTruthy();
  });

  it('rejects a late old success after invalidation and a fresh successful read', async () => {
    let release!: (response: MentionSearchResponse) => void;
    const oldResponse = new Promise<MentionSearchResponse>((resolve) => {
      release = resolve;
    });
    const search = jest.fn((request: MentionSearchRequest) =>
      isRows(request) ? Promise.resolve(emptyRows) : oldResponse
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel();

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    search.mockImplementation(async (request) => (isRows(request) ? emptyRows : pageResponse('Current')));
    act(() => {
      panel.emitter.emit(APP_EVENTS.PERMISSION_CHANGED);
    });
    expect(await screen.findByRole('button', { name: 'Current' })).toBeTruthy();
    await act(async () => {
      release(pageResponse('Target'));
      await oldResponse;
    });
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Current' })).toBeTruthy();
  });

  it('does not reuse cached suggestions after unmount and remount under the same identity', async () => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const first = mountPanel();

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    first.unmount();
    search.mockRejectedValue(retryLater);
    mountPanel();
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
  });

  it.each(['share', 'session', 'refresh', 'storage'])(
    'hides results and prevents insertion synchronously on %s invalidation',
    async (event) => {
      localStorage.setItem(TOKEN_STORAGE_KEY, sessionToken('original'));
      mockEditorContext.searchMentions = jest.fn(async (request: MentionSearchRequest) =>
        isRows(request) ? emptyRows : pageResponse('Target')
      );
      const panel = mountPanel();
      const option = await screen.findByRole('button', { name: 'Target' });

      act(() => {
        if (event === 'share') panel.emitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED);
        else if (event === 'session') emit(EventType.SESSION_INVALID);
        else if (event === 'refresh') emit(EventType.SESSION_REFRESH, sessionToken('replacement'));
        else window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY, newValue: null }));
        // Selection runs before React can clean up the old effect/DOM.
        fireEvent.click(option);
      });
      expect(mockAddMark).not.toHaveBeenCalled();
      expect(mockRemoveContent).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    }
  );

  it.each(['socket', 'focus', 'online', 'offline', 'visible', 'token-refresh'])(
    'keeps suggestions and the highlighted option on %s',
    async (event) => {
      localStorage.setItem(TOKEN_STORAGE_KEY, sessionToken('original'));
      const search = jest.fn(async (request: MentionSearchRequest) =>
        isRows(request) ? emptyRows : pageResponse('Target')
      );

      mockEditorContext.searchMentions = search;
      const panel = mountPanel();
      const option = await screen.findByRole('button', { name: 'Target' });

      await act(async () => {
        Transforms.select(panel.editor, Editor.end(panel.editor, []));
      });
      await act(async () => {
        fireEvent.keyDown(screen.getByTestId('mounted-editor'), { key: 'ArrowDown' });
      });
      expect(option.getAttribute('data-selected')).toBe('true');
      act(() => {
        if (event === 'socket') panel.emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 0);
        else if (event === 'visible') document.dispatchEvent(new Event('visibilitychange'));
        else if (event === 'token-refresh') emit(EventType.SESSION_REFRESH, sessionToken('original', 1));
        else window.dispatchEvent(new Event(event));
      });
      expect(screen.getByRole('button', { name: 'Target' }).getAttribute('data-selected')).toBe('true');
      await act(async () => {
        fireEvent.keyDown(screen.getByTestId('mounted-editor'), { key: 'Enter', keyCode: 13, which: 13 });
      });
      expect(mockAddMark).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledTimes(2);
    }
  );

  it('revalidates suggestions in the background after the socket reconnects', async () => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel(Object.assign(new EventEmitter(), { webSocketReadyState: 1 }));

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    search.mockImplementation(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Fresh')
    );
    act(() => {
      panel.emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 3);
      panel.emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
    });
    expect(screen.getByRole('button', { name: 'Target' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Fresh' })).toBeTruthy();
    expect(search).toHaveBeenCalledTimes(4);
  });

  // Partial row results are shown but never cached, so the reconnect refresh runs a full search.
  it.each([
    ['keeps', 'a network failure', new Error('Network Error')],
    ['keeps', 'a server error', { code: 502, httpStatus: 502, message: 'Bad Gateway' }],
    ['drops', 'a permission denial', { code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'denied' }],
  ])('%s uncached suggestions when their reconnect refresh hits %s', async (outcome, _failure, error) => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? { ...emptyRows, partial: true } : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel(Object.assign(new EventEmitter(), { webSocketReadyState: 1 }));

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    search.mockRejectedValue(error);
    act(() => {
      panel.emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 3);
      panel.emitter.emit(APP_EVENTS.WEBSOCKET_STATUS, 1);
    });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(5));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    if (outcome === 'keeps') {
      expect(screen.getByRole('button', { name: 'Target' })).toBeTruthy();
      expect(screen.queryByText('findAndReplace.noResult')).toBeNull();
    } else {
      expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    }
  });

  it.each(['account', 'workspace', 'server', 'signed-out'])(
    'hides old results on %s replacement',
    async (replacement) => {
      const search = jest.fn(async (request: MentionSearchRequest) =>
        isRows(request) ? emptyRows : pageResponse('Target')
      );

      mockEditorContext.searchMentions = search;
      const panel = mountPanel();

      expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
      search.mockRejectedValue(retryLater);
      if (replacement === 'account') mockSession.userId = 'different-account';
      else if (replacement === 'workspace') mockEditorContext.workspaceId = 'different-workspace';
      else if (replacement === 'server')
        jest.spyOn(runtimeConfig, 'getConfigValue').mockReturnValue('https://another.example');
      else mockSession.authenticated = false;
      panel.redraw();
      expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    }
  );

  it('fences authenticated local fallback refreshes after permission revocation', async () => {
    const panel = mountPanel();
    const option = await screen.findByRole('button', { name: 'Target' });
    let release!: (views: View[]) => void;
    const pending = new Promise<View[]>((resolve) => {
      release = resolve;
    });

    mockLoadViews.mockReturnValueOnce(pending).mockResolvedValue([]);
    act(() => {
      panel.emitter.emit(APP_EVENTS.PERMISSION_CHANGED);
      fireEvent.click(option);
    });
    expect(mockAddMark).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    act(() => {
      panel.emitter.emit(APP_EVENTS.PERMISSION_CHANGED);
    });
    await act(async () => {
      release([{ view_id: 'Target', name: 'Target', layout: ViewLayout.Document } as View]);
      await pending;
    });
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
  });

  async function startPageCreation(failure: unknown = { code: 1012, message: 'denied' }) {
    let release!: (view: { view_id: string }) => void;
    let fail!: (error: unknown) => void;
    const pending = new Promise<{ view_id: string }>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    const addPage = jest.fn(() => pending);
    const openPageModal = jest.fn();

    mockEditorContext.viewId = 'parent';
    mockEditorContext.addPage = addPage;
    mockEditorContext.openPageModal = openPageModal;
    const panel = mountPanel();

    await screen.findByRole('button', { name: 'Target' });
    await act(async () => {
      Transforms.select(panel.editor, Editor.end(panel.editor, []));
    });
    const create = screen.getByRole('button', { name: /button.create.*document.slashMenu.subPage.keyword1/ });

    fireEvent.click(create);
    expect(addPage).toHaveBeenCalledTimes(1);
    const settle = async (outcome: 'created' | 'failed') => {
      await act(async () => {
        if (outcome === 'created') release({ view_id: 'new-page' });
        else fail(failure);
        await pending.catch(() => undefined);
      });
    };

    return { panel, addPage, openPageModal, create, settle };
  }

  it('inserts the page it created even when a permission change lands during creation', async () => {
    const { panel, openPageModal, settle } = await startPageCreation();

    act(() => {
      panel.emitter.emit(APP_EVENTS.PERMISSION_CHANGED);
    });
    await settle('created');
    expect(mockRemoveContent).toHaveBeenCalledTimes(1);
    expect(mockClosePanel).toHaveBeenCalledTimes(1);
    expect(mockAddMark).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: { page_id: 'new-page', type: 'childPage' } })
    );
    expect(openPageModal).toHaveBeenCalledWith('new-page');
  });

  it('inserts a created page in a host without a signed-in session', async () => {
    mockSession.authenticated = false;
    const { openPageModal, settle } = await startPageCreation();

    await settle('created');
    expect(mockAddMark).toHaveBeenCalledTimes(1);
    expect(openPageModal).toHaveBeenCalledWith('new-page');
  });

  it('ignores repeated create clicks while the page is being created', async () => {
    const { addPage, create, settle } = await startPageCreation();

    fireEvent.click(create);
    fireEvent.click(create);
    expect(addPage).toHaveBeenCalledTimes(1);
    await settle('created');
    expect(mockAddMark).toHaveBeenCalledTimes(1);
  });

  it('offers to open a page that was created after the picker closed', async () => {
    const { panel, openPageModal, settle } = await startPageCreation();

    mockPanelContext.isPanelOpen = () => false;
    panel.redraw();
    await settle('created');
    expect(mockRemoveContent).not.toHaveBeenCalled();
    expect(mockAddMark).not.toHaveBeenCalled();
    expect(openPageModal).not.toHaveBeenCalled();
    const [message, options] = mockToastSuccess.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } }
    ];

    expect(message).toBe('document.mention.pageCreated');
    expect(options.action.label).toBe('document.mention.openPage');
    options.action.onClick();
    expect(openPageModal).toHaveBeenCalledWith('new-page');
  });

  it('does not touch an editor that closed while the page was being created', async () => {
    const { panel, openPageModal, settle } = await startPageCreation();

    panel.unmount();
    await settle('created');
    expect(mockRemoveContent).not.toHaveBeenCalled();
    expect(mockAddMark).not.toHaveBeenCalled();
    expect(openPageModal).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('stays silent after a session change', async () => {
    const { openPageModal, settle } = await startPageCreation();

    act(() => {
      emit(EventType.SESSION_INVALID);
    });
    await settle('created');
    expect(mockRemoveContent).not.toHaveBeenCalled();
    expect(mockAddMark).not.toHaveBeenCalled();
    expect(openPageModal).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', new Error('Network Error'), 'document.mention.createPageFailed'],
    ['denied', { code: 1012, message: 'user cannot create children' }, 'document.mention.createPageDenied'],
  ])('reports a %s page creation and lets the user try again', async (_case, failure, message) => {
    const { addPage, create, settle } = await startPageCreation(failure);

    await settle('failed');
    expect(mockNotifyError).toHaveBeenCalledWith(message);
    expect(mockAddMark).not.toHaveBeenCalled();
    expect(mockRemoveContent).not.toHaveBeenCalled();
    fireEvent.click(create);
    expect(addPage).toHaveBeenCalledTimes(2);
  });

  it('keeps anonymous published-page fallback available', async () => {
    mockSession.authenticated = false;
    mountPanel();
    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
  });

  it('excludes reminders from cell searches and ignores unsupported results', async () => {
    mockPanelContext.activePanel = PanelType.Mention;
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
    mockPanelContext.searchText = 'tomorrow';
    mockEditorContext.enableReminderMentions = false;
    const search = jest.fn(async (request: MentionSearchRequest) => ({
      sections: request.include?.includes(MentionTargetKind.Date)
        ? [
            {
              kind: 'dates',
              title: 'Dates',
              items: [
                { kind: 'date', object_id: 'date', title: 'Tomorrow', mention: { type: 'date', date: '2026-10-05' } },
                {
                  kind: 'reminder',
                  object_id: 'reminder',
                  title: 'Reminder tomorrow',
                  mention: { type: 'date', date: '2026-10-05', reminder_id: 'r1' },
                },
              ],
            },
          ]
        : [],
    }));

    mockEditorContext.searchMentions = search;
    const editor = withReact(createEditor());

    render(
      <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@tomorrow' }] }]}>
        <Editable />
        <MentionPanel notifyOnInsert={false} />
      </Slate>
    );
    expect(await screen.findByRole('button', { name: /Tomorrow/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reminder tomorrow/ })).toBeNull();
    for (const [request] of search.mock.calls) {
      expect(request.include).not.toContain(MentionTargetKind.Reminder);
    }
  });

  it.each([
    [true, false],
    [false, false],
    [true, true],
  ])('routes the notification choice: immediate=%s deferred=%s', async (notifyOnInsert, deferred) => {
    const onPersonPicked = jest.fn();

    mockPanelContext.activePanel = PanelType.Mention;
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
    mockPanelContext.searchText = 'Ada';
    mockEditorContext.searchMentions = jest.fn(async (request: MentionSearchRequest) => ({
      sections: request.include?.includes(MentionTargetKind.Person)
        ? [
            {
              kind: 'people',
              title: 'People',
              items: [
                {
                  kind: 'person',
                  object_id: 'ada',
                  title: 'Ada',
                  mention: { type: 'person', person_id: 'ada', person_name: 'Ada' },
                },
              ],
            },
          ]
        : [{ kind: 'database_rows', items: [], status: 'ready' }],
    }));
    const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });

    render(
      <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@Ada' }] }]}>
        <Editable />
        <MentionPanel notifyOnInsert={notifyOnInsert} onPersonPicked={deferred ? onPersonPicked : undefined} />
      </Slate>
    );
    await act(async () => {
      Transforms.select(editor, Editor.end(editor, []));
    });
    const person = await screen.findByRole('button', { name: /Ada/ });

    const toggle = screen.getByRole('switch');

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    if (deferred) fireEvent.click(toggle);

    await act(async () => {
      fireEvent.mouseDown(person);
      fireEvent.click(person);
    });
    expect(mockAddMark).toHaveBeenCalledTimes(1);
    expect(mockNotifyPerson).toHaveBeenCalledTimes(notifyOnInsert && !deferred ? 1 : 0);
    if (deferred) expect(onPersonPicked).toHaveBeenCalledWith('ada', true);
    else if (notifyOnInsert)
      expect(mockNotifyPerson).toHaveBeenCalledWith(expect.objectContaining({ person_id: 'ada' }), false);
  });

  it.each([false, true])('leaves composing Enter to the IME (highlighted result: %s)', async (highlighted) => {
    const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });

    render(
      <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@Target' }] }]}>
        {/* The native panel listener runs before the host's composition guard. */}
        <Editable data-testid='editor' onKeyDown={(event) => event.nativeEvent.isComposing} />
        <MentionPanel />
      </Slate>
    );
    const editable = screen.getByTestId('editor');
    const option = await screen.findByRole('button', { name: 'Target' });

    Object.defineProperty(option, 'scrollIntoView', { value: jest.fn() });
    await act(async () => {
      Transforms.select(editor, Editor.end(editor, []));
    });
    if (highlighted) {
      await act(async () => {
        fireEvent.keyDown(editable, { key: 'ArrowDown' });
      });
      expect(option.getAttribute('data-selected')).toBe('true');
    }

    const confirmation = new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      which: 13,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      fireEvent(editable, confirmation);
    });
    expect(confirmation.defaultPrevented).toBe(false);
    expect(mockClosePanel).not.toHaveBeenCalled();
    expect(mockRemoveContent).not.toHaveBeenCalled();
    expect(mockAddMark).not.toHaveBeenCalled();
    expect(Editor.string(editor, [])).toBe('@Target');

    if (highlighted) {
      await act(async () => {
        fireEvent.keyDown(editable, { key: 'Enter', keyCode: 13, which: 13 });
      });
      expect(mockClosePanel).toHaveBeenCalledTimes(1);
      expect(mockRemoveContent).toHaveBeenCalledTimes(1);
      expect(mockAddMark).toHaveBeenCalledTimes(1);
    }
  });
});
