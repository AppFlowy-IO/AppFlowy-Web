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
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid='mention-panel'>{children}</div> : null,
  calculateOptimalOrigins: () => ({ transformOrigin: { vertical: 'top', horizontal: 'left' } }),
}));

const retryLater = { code: ERROR_CODE.RETRY_LATER, message: 'refresh permissions' };
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
        <Editable />
        <MentionPanel />
      </Slate>
    </AppEventEmitterContext.Provider>
  );
  const rendered = render(tree());

  return { ...rendered, emitter, editor, redraw: () => rendered.rerender(tree()) };
}

describe('MentionPanel composition', () => {
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

  it('starts a reopened mounted picker empty, without reusing its last opening', async () => {
    const search = jest.fn(async (request: MentionSearchRequest) =>
      isRows(request) ? emptyRows : pageResponse('Target')
    );

    mockEditorContext.searchMentions = search;
    const panel = mountPanel();

    expect(await screen.findByRole('button', { name: 'Target' })).toBeTruthy();
    mockPanelContext.isPanelOpen = () => false;
    panel.redraw();
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

  it.each([false, true])('does not publish parallel page results after row RetryLater (retry=%s)', async (retry) => {
    let rows = 0;
    const search = jest.fn(async (request: MentionSearchRequest) => {
      if (!isRows(request)) return pageResponse('Target');
      rows += 1;
      if (retry && rows === 1) return { ...emptyRows, partial: true };
      throw retryLater;
    });

    mockEditorContext.searchMentions = search;
    mountPanel();
    await waitFor(() => expect(rows).toBe(retry ? 2 : 1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
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

  it.each(['share', 'socket', 'focus', 'online', 'offline', 'session', 'refresh', 'storage', 'visible'])(
    'hides results and prevents insertion synchronously on %s invalidation',
    async (event) => {
      mockEditorContext.searchMentions = jest.fn(async (request: MentionSearchRequest) =>
        isRows(request) ? emptyRows : pageResponse('Target')
      );
      const panel = mountPanel();
      const option = await screen.findByRole('button', { name: 'Target' });

      act(() => {
        if (event === 'share') panel.emitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED);
        else if (event === 'socket') panel.emitter.emit(APP_EVENTS.WEBSOCKET_STATUS);
        else if (event === 'session') emit(EventType.SESSION_INVALID);
        else if (event === 'refresh') emit(EventType.SESSION_REFRESH);
        else if (event === 'storage') window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY }));
        else if (event === 'visible') document.dispatchEvent(new Event('visibilitychange'));
        else window.dispatchEvent(new Event(event));
        // Selection runs before React can clean up the old effect/DOM.
        fireEvent.click(option);
      });
      expect(mockAddMark).not.toHaveBeenCalled();
      expect(mockRemoveContent).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
    }
  );

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

  it.each(['permission', 'unmount'])(
    'does not insert or navigate after a late page creation and %s',
    async (boundary) => {
      let release!: (view: { view_id: string }) => void;
      const pending = new Promise<{ view_id: string }>((resolve) => {
        release = resolve;
      });
      const addPage = jest.fn(() => pending);
      const openPageModal = jest.fn();

      mockEditorContext.viewId = 'parent';
      mockEditorContext.addPage = addPage;
      mockEditorContext.openPageModal = openPageModal;
      const panel = mountPanel();

      await screen.findByRole('button', { name: 'Target' });
      const create = screen.getByRole('button', { name: /button.create.*document.slashMenu.subPage.keyword1/ });

      fireEvent.click(create);
      expect(addPage).toHaveBeenCalledTimes(1);
      if (boundary === 'unmount') panel.unmount();
      else
        act(() => {
          panel.emitter.emit(APP_EVENTS.PERMISSION_CHANGED);
        });
      await act(async () => {
        release({ view_id: 'new-page' });
        await pending;
      });
      expect(mockRemoveContent).not.toHaveBeenCalled();
      expect(mockAddMark).not.toHaveBeenCalled();
      expect(openPageModal).not.toHaveBeenCalled();
    }
  );

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
