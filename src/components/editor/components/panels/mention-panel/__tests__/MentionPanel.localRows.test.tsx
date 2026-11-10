import { EventEmitter } from 'events';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import type { MentionPickerSession } from '@/application/services/js-services/http/mention-presentation-metrics';
import {
  MentionSearchOptions,
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
} from '@/application/types';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';

import { MentionPanel } from '../MentionPanel';
import { clearMentionLocalIndex } from '../mentionLocalIndex';
import { clearMentionSessionPersonPicks } from '../mentionLocalLane';
import {
  mentionLocalRowItem,
  MentionLocalRow,
  MentionLocalRowsAccess,
  MentionLocalRowsSnapshot,
} from '../mentionLocalRows';
import { clearMentionSearchCacheForTests } from '../mentionSearchCache';
import {
  MENTION_LOCAL_LANE_OVERRIDE_KEY,
  MENTION_LOCAL_ROWS_OVERRIDE_KEY,
  MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY,
  MENTION_TYPEAHEAD_V2_OVERRIDE_KEY,
} from '../mentionTypeaheadFlag';

const mockAddMark = jest.fn();
const mockReport = jest.fn();
const WORKSPACE = 'workspace';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const DATABASE = uuid(0xdb);
const GRID = uuid(0xa1);
const ZEBRA = uuid(1);
const BUDGET = uuid(2);
const mockCurrentUser = {
  uid: '7',
  uuid: uuid(99),
  email: 'me@appflowy.io',
  name: 'Me',
  avatar: null,
  latestWorkspaceId: WORKSPACE,
};
const mockPanelContext: Record<string, unknown> = {
  activePanel: PanelType.Mention,
  activeTrigger: '@',
  isPanelOpen: (panel: PanelType) => panel === PanelType.Mention,
  panelPosition: { top: 0, left: 0 },
  searchText: '',
  closePanel: jest.fn(),
  removeContent: jest.fn(),
};
const mockEditorContext: Record<string, unknown> = { workspaceId: WORKSPACE };
const mockT = (key: string) => key;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: {} }));
jest.mock('@/application/services/js-services/http/mention-presentation-metrics', () => ({
  ...jest.requireActual('@/application/services/js-services/http/mention-presentation-metrics'),
  reportMentionPickerSession: (...args: unknown[]) => mockReport(...args),
}));
jest.mock('../useNotifyPersonMention', () => ({ useNotifyPersonMention: () => jest.fn() }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { addMark: (...args: unknown[]) => mockAddMark(...args) },
}));
jest.mock('@/components/editor/components/panels/Panels.hooks', () => ({
  usePanelContext: () => mockPanelContext,
}));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => mockEditorContext }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => mockCurrentUser }));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  calculateOptimalOrigins: () => ({ transformOrigin: { vertical: 'top', horizontal: 'left' } }),
}));

type Lane = 'bare' | 'primary' | 'rows';

interface Reply {
  delayMs: number;
  response?: MentionSearchResponse;
}

const EMPTY: MentionSearchResponse = { sections: [] };

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

function pages(...items: MentionSearchResultItem[]): MentionSearchResponse {
  return { sections: [section(MentionSearchSectionKind.Pages, items)] };
}

function page(id: string, title: string): MentionSearchResultItem {
  return { kind: MentionTargetKind.Page, object_id: id, title, mention: { type: MentionTargetKind.Page, page_id: id } };
}

function laneOf(request: MentionSearchRequest): Lane {
  if (!request.query?.trim()) return 'bare';
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow ? 'rows' : 'primary';
}

function createSearch(reply: (lane: Lane, query: string) => Reply) {
  return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
    const { delayMs, response } = reply(laneOf(request), request.query ?? '');

    return new Promise<MentionSearchResponse>((resolve, rejectSearch) => {
      const timer = setTimeout(() => resolve(response ?? EMPTY), delayMs);

      options?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          rejectSearch({ code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' });
        },
        { once: true }
      );
    });
  });
}

type SearchMock = ReturnType<typeof createSearch>;

/** The rows a database holds, as a source the test changes. */
function rowsSource(initial: MentionLocalRowsSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const subscribe = jest.fn((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  const access: MentionLocalRowsAccess = { source: { getSnapshot: () => snapshot, subscribe }, databaseViewId: GRID };

  return {
    access,
    subscribe,
    listeners,
    set: (next: MentionLocalRowsSnapshot) => {
      snapshot = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

function snapshot(rows: MentionLocalRow[], complete: boolean): MentionLocalRowsSnapshot {
  return { databaseId: DATABASE, rows, complete };
}

function renderPanel() {
  const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });
  const tree = () => (
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@zeb' }] }]}>
      <Editable data-testid='editor' />
      <MentionPanel notifyOnInsert={false} />
    </Slate>
  );
  const view = render(tree());

  return { editor, rerender: () => view.rerender(tree()) };
}

type PanelView = ReturnType<typeof renderPanel>;

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function openPanel(search: SearchMock, waitMs = 100) {
  mockPanelContext.searchText = '';
  mockEditorContext.searchMentions = search;

  const view = renderPanel();

  await advance(waitMs);
  return view;
}

function type(view: PanelView, query: string) {
  mockPanelContext.searchText = query;
  view.rerender();
}

function resultOptions() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-option-kind]'));
}

function titles() {
  return resultOptions().map((option) => option.textContent);
}

function freshTitles() {
  return resultOptions()
    .filter((option) => option.getAttribute('data-fresh') === 'true')
    .map((option) => option.textContent);
}

function lanesSent(search: SearchMock) {
  return search.mock.calls.map(([request]) => `${laneOf(request)}:${request.query ?? ''}`);
}

async function pickWithEnter(view: PanelView, title: string) {
  await act(async () => {
    Transforms.select(view.editor, Editor.end(view.editor, []));
  });
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('editor'), { key: 'ArrowDown' });
    });
    if (document.querySelector<HTMLElement>('[data-selected="true"]')?.textContent?.startsWith(title)) break;
  }

  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Enter' });
  });
}

const NOW = Date.UTC(2026, 10, 11, 12);
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const BARE_BUDGET = (lane: Lane): Reply =>
  lane === 'bare' ? { delayMs: 50, response: pages(page('budget-page', 'Budget')) } : { delayMs: 300, response: EMPTY };

describe('MentionPanel local rows lane (MEN-WEB-15)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    clearMentionSearchCacheForTests();
    clearMentionLocalIndex();
    clearMentionSessionPersonPicks();
    localStorage.clear();
    localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
    mockPanelContext.searchText = '';
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
    Object.keys(mockEditorContext).forEach((key) => delete mockEditorContext[key]);
    mockEditorContext.workspaceId = WORKSPACE;
    mockEditorContext.viewId = GRID;
    mockEditorContext.mentionContext = { view_id: GRID, database_view_id: GRID, row_id: BUDGET };
    Element.prototype.scrollIntoView = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    clearMentionLocalIndex();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('a row created a second ago', () => {
    const rows = () =>
      rowsSource(
        snapshot(
          [
            { rowId: ZEBRA, title: 'Zebra launch', createdAtMs: NOW - SECOND },
            { rowId: BUDGET, title: 'Budget review', createdAtMs: NOW - 30 * 24 * 60 * MINUTE },
          ],
          false
        )
      );

    it('is listed in the render of the keystroke that matches it, flagged fresh, before any answer', async () => {
      const source = rows();

      mockEditorContext.mentionLocalRows = source.access;

      const view = await openPanel(createSearch(BARE_BUDGET));

      expect(source.subscribe).toHaveBeenCalledTimes(1);
      type(view, 'zeb');
      // No timer ran since the keystroke: the list comes from this render.
      expect(titles()).toEqual(['Zebra launch']);
      expect(freshTitles()).toEqual(['Zebra launch']);

      await advance(1_000);
      expect(titles()).toEqual(['Zebra launch']);
      expect(freshTitles()).toEqual(['Zebra launch']);
      expect(screen.queryByText('findAndReplace.noResult')).toBeNull();
    });

    it("is inserted as the server's row would be, and reported as the local lane's pick", async () => {
      mockEditorContext.mentionLocalRows = rows().access;

      const view = await openPanel(createSearch(BARE_BUDGET));

      type(view, 'zeb');
      await advance(1_000);
      await pickWithEnter(view, 'Zebra launch');

      expect(mockAddMark).toHaveBeenCalledWith(
        view.editor,
        expect.objectContaining({
          value: expect.objectContaining({
            type: MentionType.PageRef,
            page_id: GRID,
            block_id: ZEBRA,
            database_id: DATABASE,
            database_view_id: GRID,
            row_id: ZEBRA,
            database_row_id: ZEBRA,
          }),
        })
      );

      cleanup();
      await act(async () => {
        await Promise.resolve();
      });

      const session = mockReport.mock.calls[0]?.[1] as MentionPickerSession | undefined;

      expect(session).toMatchObject({ outcome: 'selected', selected_rank: 1, selected_source: 'local' });
    });

    it('is not flagged fresh 16 minutes after its creation, and still listed', async () => {
      mockEditorContext.mentionLocalRows = rowsSource(
        snapshot([{ rowId: ZEBRA, title: 'Zebra launch', createdAtMs: NOW - 16 * MINUTE }], false)
      ).access;

      const view = await openPanel(createSearch(BARE_BUDGET));

      type(view, 'zeb');
      expect(titles()).toEqual(['Zebra launch']);
      expect(freshTitles()).toEqual([]);
    });

    it('is listed once, with the server payload, when the server lists it too', async () => {
      const serverRow = {
        ...mentionLocalRowItem(DATABASE, uuid(0xa2), { rowId: ZEBRA, title: 'Zebra launch' }),
        row_document_id: uuid(0xd0),
      };

      mockEditorContext.mentionLocalRows = rows().access;

      const view = await openPanel(
        createSearch((lane) => (lane === 'rows' ? { delayMs: 300, response: pages(serverRow) } : BARE_BUDGET(lane)))
      );

      type(view, 'zeb');
      await advance(1_000);
      expect(titles()).toEqual(['Zebra launch']);
      expect(freshTitles()).toEqual([]);

      await pickWithEnter(view, 'Zebra launch');
      expect(mockAddMark).toHaveBeenCalledWith(
        view.editor,
        expect.objectContaining({
          value: expect.objectContaining({ database_view_id: uuid(0xa2), row_document_id: uuid(0xd0) }),
        })
      );
    });

    it('matches a row by any word of its title, and lists none for a query no title holds', async () => {
      mockEditorContext.mentionLocalRows = rows().access;

      const view = await openPanel(createSearch(BARE_BUDGET));

      type(view, 'launch');
      expect(titles()).toEqual(['Zebra launch']);
      type(view, 'review');
      expect(titles()).toEqual(['Budget review']);
      type(view, 'roadmap');
      expect(titles()).toEqual([]);
    });
  });

  describe("the server's rows request", () => {
    const zebra: MentionLocalRow = { rowId: ZEBRA, title: 'Zebra launch', createdAtMs: NOW - SECOND };

    it('is left out when every row of the database is in memory and the browser asks for it', async () => {
      localStorage.setItem(MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY, 'true');
      mockEditorContext.mentionLocalRows = rowsSource(snapshot([zebra], true)).access;

      const search = createSearch(BARE_BUDGET);
      const view = await openPanel(search);

      type(view, 'zeb');
      await advance(1_000);
      type(view, 'zebr');
      await advance(1_000);

      expect(lanesSent(search)).toEqual(['bare:', 'primary:zeb', 'primary:zebr']);
      // The primary request still asks for no rows, so the server sends none.
      search.mock.calls.forEach(([request]) => expect(request.include).not.toContain(MentionTargetKind.DatabaseRow));
      expect(titles()).toEqual(['Zebra launch']);
    });

    it('is still sent while a row of the database is not in memory', async () => {
      localStorage.setItem(MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY, 'true');
      mockEditorContext.mentionLocalRows = rowsSource(snapshot([zebra], false)).access;

      const search = createSearch(BARE_BUDGET);
      const view = await openPanel(search);

      type(view, 'zeb');
      await advance(1_000);

      expect(lanesSent(search)).toEqual(['bare:', 'primary:zeb', 'rows:zeb']);
      // Filtered to the database the cell is in, as before.
      expect(search.mock.calls[2][0].filter).toEqual({
        database_ids: [],
        database_view_ids: [GRID],
        database_row_ids: [],
      });
    });

    it('is still sent by default, even when every row is in memory', async () => {
      mockEditorContext.mentionLocalRows = rowsSource(snapshot([zebra], true)).access;

      const search = createSearch(BARE_BUDGET);
      const view = await openPanel(search);

      type(view, 'zeb');
      await advance(1_000);

      expect(lanesSent(search)).toEqual(['bare:', 'primary:zeb', 'rows:zeb']);
    });

    it('is left out from the next keystroke once the last row is in memory', async () => {
      localStorage.setItem(MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY, 'true');

      const source = rowsSource(snapshot([zebra], false));

      mockEditorContext.mentionLocalRows = source.access;

      const search = createSearch(BARE_BUDGET);
      const view = await openPanel(search);

      type(view, 'zeb');
      await advance(1_000);
      source.set(snapshot([zebra], true));
      type(view, 'zebr');
      await advance(1_000);

      expect(lanesSent(search)).toEqual(['bare:', 'primary:zeb', 'rows:zeb', 'primary:zebr']);
    });

    it('is still sent for a row page of another database than the rows the editor holds', async () => {
      localStorage.setItem(MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY, 'true');
      mockEditorContext.mentionContext = { view_id: uuid(0xd1), database_id: uuid(0xee), row_id: BUDGET };
      mockEditorContext.mentionLocalRows = rowsSource(snapshot([zebra], true)).access;

      const search = createSearch(BARE_BUDGET);
      const view = await openPanel(search);

      type(view, 'zeb');
      await advance(1_000);

      expect(lanesSent(search)).toEqual(['bare:', 'primary:zeb', 'rows:zeb']);
    });
  });

  describe('switched off', () => {
    const zebra = snapshot([{ rowId: ZEBRA, title: 'Zebra launch', createdAtMs: NOW - SECOND }], true);

    it.each([
      ['its own switch', MENTION_LOCAL_ROWS_OVERRIDE_KEY],
      ['the local lane', MENTION_LOCAL_LANE_OVERRIDE_KEY],
      ["the picker's v2", MENTION_TYPEAHEAD_V2_OVERRIDE_KEY],
    ])('with %s off, lists no local row, reads no rows and sends the rows request', async (_, key) => {
      localStorage.setItem(key, 'false');
      localStorage.setItem(MENTION_LOCAL_ROWS_SKIP_SERVER_OVERRIDE_KEY, 'true');

      const source = rowsSource(zebra);

      mockEditorContext.mentionLocalRows = source.access;

      const search = createSearch(BARE_BUDGET);
      const view = await openPanel(search);

      type(view, 'zeb');
      await advance(1_000);

      expect(titles()).toEqual([]);
      expect(source.subscribe).not.toHaveBeenCalled();
      expect(lanesSent(search)).toEqual(['bare:', 'primary:zeb', 'rows:zeb']);
    });

    it('subscribes only while the picker is open', async () => {
      const source = rowsSource(zebra);

      mockEditorContext.mentionLocalRows = source.access;

      const view = await openPanel(createSearch(BARE_BUDGET));

      expect(source.listeners.size).toBe(1);
      mockPanelContext.isPanelOpen = () => false;
      view.rerender();
      expect(source.listeners.size).toBe(0);
    });
  });

  it('lists no row of a view the user lost access to', async () => {
    const emitter = new EventEmitter();

    mockEditorContext.eventEmitter = emitter;
    mockEditorContext.mentionLocalRows = rowsSource(
      snapshot([{ rowId: ZEBRA, title: 'Zebra launch', createdAtMs: NOW - SECOND }], true)
    ).access;

    const view = await openPanel(createSearch(BARE_BUDGET));

    type(view, 'zeb');
    expect(titles()).toEqual(['Zebra launch']);

    act(() => {
      emitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: GRID });
    });
    expect(titles()).toEqual([]);
  });

  it('keeps a bare @ as it was: rows never show there', async () => {
    mockEditorContext.mentionLocalRows = rowsSource(
      snapshot([{ rowId: ZEBRA, title: 'Zebra launch', createdAtMs: NOW - SECOND }], true)
    ).access;
    await openPanel(createSearch(BARE_BUDGET));

    expect(titles()).toEqual(['Budget']);
  });
});
