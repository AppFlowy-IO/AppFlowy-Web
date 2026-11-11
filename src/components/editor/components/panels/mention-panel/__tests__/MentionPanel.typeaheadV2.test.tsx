import { EventEmitter } from 'events';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
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
import { MENTION_TYPED_DEADLINE_MS } from '../mentionRequestLanes';
import {
  clearMentionSearchCacheForTests,
  MENTION_SEARCH_CACHE_FRESH_MS,
  setCachedMentionSections,
} from '../mentionSearchCache';
import { MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY, MENTION_SCHEDULER_MODE_OVERRIDE_KEY } from '../mentionSearchScheduler';
import {
  MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY,
  MENTION_LOCAL_LANE_OVERRIDE_KEY,
  MENTION_TYPEAHEAD_V2_OVERRIDE_KEY,
} from '../mentionTypeaheadFlag';
import { buildMentionSearchRequestsCacheKey } from '../mentionUtils';

const mockAddMark = jest.fn();
const mockReport = jest.fn();

const mockPanelContext: Record<string, unknown> = {
  activePanel: PanelType.Mention,
  activeTrigger: '@',
  isPanelOpen: (panel: PanelType) => panel === PanelType.Mention,
  panelPosition: { top: 0, left: 0 },
  searchText: '',
  closePanel: jest.fn(),
  removeContent: jest.fn(),
};
const mockEditorContext: Record<string, unknown> = { workspaceId: 'workspace' };

// A stable `t`, as react-i18next gives one per language: memos that depend on it keep their value.
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
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => undefined }));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  calculateOptimalOrigins: () => ({ transformOrigin: { vertical: 'top', horizontal: 'left' } }),
}));

type Lane = 'bare' | 'primary' | 'rows';

/** How the mocked server answers one request: after `delayMs`, with `response` or by failing. */
interface Reply {
  delayMs: number;
  response?: MentionSearchResponse;
  error?: unknown;
}

/** A request that answers only once its signal aborts it, at its deadline. */
const NEVER: Reply = { delayMs: 1e9 };
const EMPTY: MentionSearchResponse = { sections: [] };

function page(title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Page,
    object_id: title,
    title,
    mention: { type: MentionTargetKind.Page, page_id: title },
  };
}

function row(title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.DatabaseRow,
    object_id: title,
    title,
    mention: { type: MentionTargetKind.DatabaseRow, database_id: 'database', database_view_id: 'grid', row_id: title },
  };
}

function person(id: string, name: string, email: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: id,
    title: name,
    subtitle: email,
    mention: { type: MentionTargetKind.Person, person_id: id, person_name: name, page_id: 'page' },
  };
}

// Cloud computes a reminder quick pick's time when it answers, and keys it by kind and title only.
function reminder(title: string, start: string, shown: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Reminder,
    title,
    subtitle: shown,
    mention: { type: MentionTargetKind.Date, start, include_time: true },
  };
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

function pages(...items: MentionSearchResultItem[]): MentionSearchResponse {
  return { sections: [section(MentionSearchSectionKind.Pages, items)] };
}

const ROADMAP = page('Roadmap');
const BUDGET = page('Budget');
const ROAD_TRIP = page('Road trip');

function laneOf(request: MentionSearchRequest): Lane {
  if (!request.query?.trim()) return 'bare';
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow ? 'rows' : 'primary';
}

// What the HTTP layer rejects with once a request's signal aborts.
function cancelledError() {
  return { code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' };
}

function createSearch(reply: (lane: Lane, query: string) => Reply) {
  return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
    const { delayMs, response, error } = reply(laneOf(request), request.query ?? '');

    return new Promise<MentionSearchResponse>((resolve, rejectSearch) => {
      if (options?.signal?.aborted) {
        rejectSearch(cancelledError());
        return;
      }

      const timer = setTimeout(() => (error ? rejectSearch(error) : resolve(response ?? EMPTY)), delayMs);

      options?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          rejectSearch(cancelledError());
        },
        { once: true }
      );
    });
  });
}

type SearchMock = ReturnType<typeof createSearch>;

/** What each commit of the panel shows, read when React commits it. */
interface Commit {
  options: number;
  noResult: boolean;
}

let commits: Commit[] = [];

function resultOptions() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-option-kind]'));
}

function recordCommit() {
  commits.push({ options: resultOptions().length, noResult: screen.queryByText('findAndReplace.noResult') !== null });
}

function renderPanel() {
  const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });
  const tree = () => (
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@road' }] }]}>
      <Editable data-testid='editor' />
      <Profiler id='mention-panel' onRender={recordCommit}>
        <MentionPanel notifyOnInsert={false} />
      </Profiler>
    </Slate>
  );
  const view = render(tree());

  return { editor, rerender: () => view.rerender(tree()) };
}

/** Opens the panel on the bare `@` with `search`, and waits `waitMs`. */
async function openPanel(search: SearchMock, waitMs = 100) {
  mockPanelContext.searchText = '';
  mockEditorContext.searchMentions = search;

  const view = renderPanel();

  await advance(waitMs);
  return view;
}

function type(view: { rerender: () => void }, query: string) {
  mockPanelContext.searchText = query;
  view.rerender();
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function shows(text: string) {
  return screen.queryByText(text) !== null;
}

// Page and row options show their title alone.
function titles() {
  return resultOptions().map((option) => option.textContent);
}

function optionKeys() {
  return resultOptions().map((option) => option.getAttribute('data-option-key'));
}

function isBusy() {
  return document.querySelector('[aria-busy="true"]') !== null;
}

function showsProgress() {
  return document.querySelector('[data-testid="mention-progress"]') !== null;
}

function highlighted() {
  return Array.from(document.querySelectorAll('[data-option-index][data-selected="true"]')).map(
    (option) => option.textContent
  );
}

function retryRow() {
  return document.querySelector<HTMLElement>('[data-testid="mention-panel-retry"]');
}

function busyRow() {
  return document.querySelector<HTMLElement>('[data-testid="mention-panel-busy"]');
}

async function pressKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('editor'), { key });
  });
}

async function placeCaretAtEnd(editor: Editor) {
  await act(async () => {
    Transforms.select(editor, Editor.end(editor, []));
  });
}

function typedQueries(search: SearchMock) {
  return search.mock.calls.map(([request]) => request.query ?? '').filter(Boolean);
}

// The v2 turns the local lane (MEN-WEB-09) on with it, which merges the lists below with what the
// tab holds, here nothing. Every case also runs with the lane off, as `__mention_local_lane =
// 'false'` keeps MEN-WEB-08's own lists, a separate path in the panel.
describe.each([
  { localLane: true, name: 'on' },
  { localLane: false, name: 'off' },
])('MentionPanel keep-and-narrow first paint (MEN-WEB-08), local lane $name', ({ localLane }) => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    clearMentionSearchCacheForTests();
    localStorage.clear();
    localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
    if (!localLane) localStorage.setItem(MENTION_LOCAL_LANE_OVERRIDE_KEY, 'false');
    commits = [];
    mockPanelContext.searchText = '';
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
    mockEditorContext.eventEmitter = undefined;
    Element.prototype.scrollIntoView = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("shows Roadmap but not Budget for 'r' whose answer never comes, and is not busy", async () => {
    const search = createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: pages(ROADMAP, BUDGET) } : NEVER));
    const view = await openPanel(search);

    expect(titles()).toEqual(['Roadmap', 'Budget']);

    // In the same act as the keystroke.
    type(view, 'r');
    expect(titles()).toEqual(['Roadmap']);
    expect(isBusy()).toBe(false);
    expect(showsProgress()).toBe(true);
    expect(shows('findAndReplace.noResult')).toBe(false);

    await advance(1_000);
    expect(typedQueries(search)).toEqual(['r', 'r']);
    expect(titles()).toEqual(['Roadmap']);
    expect(isBusy()).toBe(false);
    expect(showsProgress()).toBe(true);

    // At the typed deadline the narrowed list stays, with the unavailable row instead of the bar.
    await advance(MENTION_TYPED_DEADLINE_MS);
    expect(titles()).toEqual(['Roadmap']);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
    expect(showsProgress()).toBe(false);
    expect(shows('findAndReplace.noResult')).toBe(false);
  });

  it('never commits an empty list between keystrokes while the server is slow', async () => {
    const search = createSearch((lane, query) => {
      if (lane === 'bare') return { delayMs: 50, response: pages(ROADMAP, ROAD_TRIP, BUDGET) };
      if (lane === 'rows') return { delayMs: 300, response: EMPTY };
      return { delayMs: 300, response: pages(query === 'roa' ? ROAD_TRIP : ROADMAP, ROADMAP) };
    });
    const view = await openPanel(search);

    expect(titles()).toEqual(['Roadmap', 'Road trip', 'Budget']);
    commits = [];

    for (const query of ['r', 'ro', 'roa']) {
      type(view, query);
      expect(titles()).toEqual(['Roadmap', 'Road trip']);
      await advance(100);
    }

    await advance(1_000);
    expect(titles()).toEqual(['Road trip', 'Roadmap']);
    expect(commits.length).toBeGreaterThan(3);
    expect(commits.filter(({ options }) => options === 0)).toEqual([]);
    expect(showsProgress()).toBe(false);
  });

  it('keeps the narrowed list on every keystroke under the contract scheduler too', async () => {
    localStorage.setItem(MENTION_SCHEDULER_MODE_OVERRIDE_KEY, 'contract');

    const search = createSearch((lane, query) => {
      if (lane === 'bare') return { delayMs: 50, response: pages(ROADMAP, ROAD_TRIP, BUDGET) };
      if (lane === 'rows') return { delayMs: 150, response: EMPTY };
      return { delayMs: 150, response: pages(query === 'road' ? ROAD_TRIP : ROADMAP) };
    });
    const view = await openPanel(search);

    commits = [];
    // `r` comes 100 ms after the `@`, so it is sent at once; the others wait for typing to pause.
    for (const query of ['r', 'ro', 'roa', 'road']) {
      type(view, query);
      expect(titles()).toEqual(['Roadmap', 'Road trip']);
      await advance(40);
    }

    await advance(1_000);
    expect(typedQueries(search)).toEqual(['r', 'r', 'road', 'road']);
    expect(titles()).toEqual(['Road trip']);
    expect(commits.filter(({ options }) => options === 0)).toEqual([]);
  });

  it("re-tiers an older server's answer, so 'Roadmap 2026' renders above a body-only 'Weekly notes'", async () => {
    const search = createSearch((lane) => {
      if (lane === 'primary') return { delayMs: 80, response: pages(page('Weekly notes'), page('Roadmap 2026')) };
      return { delayMs: 80, response: EMPTY };
    });

    mockPanelContext.searchText = 'roadmap';
    mockEditorContext.searchMentions = search;
    renderPanel();
    await advance(300);

    expect(titles()).toEqual(['Roadmap 2026', 'Weekly notes']);
  });

  it('re-tiers people by class, so a shared domain alone sorts after a name match', async () => {
    const people: MentionSearchResponse = {
      sections: [
        section(MentionSearchSectionKind.People, [
          person('brian', 'Brian Chen', 'brian@appflowy.io'),
          person('appleton', 'Appleton', 'appleton@example.com'),
        ]),
      ],
    };

    mockPanelContext.searchText = 'app';
    mockEditorContext.searchMentions = createSearch((lane) => ({
      delayMs: 80,
      response: lane === 'primary' ? people : EMPTY,
    }));
    renderPanel();
    await advance(300);

    expect(optionKeys()).toEqual(['people|person:appleton', 'people|person:brian']);
  });

  it('feeds a bare answer that arrives after typing into the keystroke at once', async () => {
    const search = createSearch((lane) =>
      lane === 'bare' ? { delayMs: 400, response: pages(ROADMAP, BUDGET) } : NEVER
    );
    const view = await openPanel(search);

    type(view, 'r');
    expect(isBusy()).toBe(true);

    await advance(300);
    expect(titles()).toEqual(['Roadmap']);
    expect(isBusy()).toBe(false);
    expect(showsProgress()).toBe(true);
  });

  it('narrows the cached answer of the longest typed prefix when the list on screen lacks a match', async () => {
    const search = createSearch((lane, query) => {
      if (lane !== 'primary') return { delayMs: 50, response: EMPTY };
      if (query === 'ro') return { delayMs: 50, response: pages(ROADMAP, page('Robot')) };
      if (query === 'rob') return { delayMs: 50, response: pages(page('Robot')) };
      return NEVER;
    });
    const view = await openPanel(search);

    type(view, 'ro');
    await advance(300);
    type(view, 'rob');
    await advance(300);
    expect(titles()).toEqual(['Robot']);

    // The list shows Robot only; `ro`'s cached answer still holds Roadmap.
    type(view, 'roa');
    expect(titles()).toEqual(['Roadmap']);
  });

  it('narrows the list on screen when no cached answer holds it, as after an answer with a failed lane', async () => {
    const search = createSearch((lane, query) => {
      if (lane === 'bare') return { delayMs: 50, response: pages(BUDGET) };
      if (query !== 'ro') return NEVER;
      if (lane === 'primary') return { delayMs: 80, response: pages(ROADMAP, page('Robot')) };
      return { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
    });
    const view = await openPanel(search);

    type(view, 'ro');
    await advance(300);
    // The rows request failed, so the answer is shown with the unavailable row, and never cached.
    expect(titles()).toEqual(['Roadmap', 'Robot']);
    expect(retryRow()).not.toBeNull();

    type(view, 'roa');
    expect(titles()).toEqual(['Roadmap']);
  });

  it('paints a cached answer in the first commit of the keystroke that comes back to it', async () => {
    const search = createSearch((lane, query) => {
      if (lane !== 'primary') return { delayMs: 50, response: EMPTY };
      // Weekly notes matched `ro` in its body, which no provisional list keeps.
      if (query === 'ro') return { delayMs: 50, response: pages(ROADMAP, page('Weekly notes')) };
      return { delayMs: 50, response: pages(page('Robot')) };
    });
    const view = await openPanel(search);

    type(view, 'ro');
    await advance(300);
    expect(titles()).toEqual(['Roadmap', 'Weekly notes']);
    type(view, 'rob');
    await advance(300);
    expect(titles()).toEqual(['Robot']);

    commits = [];
    type(view, 'ro');
    expect(titles()).toEqual(['Roadmap', 'Weekly notes']);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.map(({ options }) => options)).toEqual(commits.map(() => 2));
    await advance(1_000);
    // A fresh cached answer needs no request.
    expect(typedQueries(search).filter((query) => query === 'ro')).toHaveLength(2);
  });

  it('keeps the provisional rows while the rows request is pending, until the rows answer replaces them', async () => {
    const search = createSearch((lane, query) => {
      if (lane === 'bare') return { delayMs: 50, response: EMPTY };
      if (lane === 'primary') return { delayMs: 80, response: pages(ROADMAP) };
      if (query === 'ro') return { delayMs: 80, response: pages(row('Roadmap row')) };
      return { delayMs: 400, response: pages(row('Roadmap row'), row('Roadmap row 2')) };
    });
    const view = await openPanel(search);

    type(view, 'ro');
    await advance(300);
    expect(titles()).toEqual(['Roadmap', 'Roadmap row']);

    // `roa` is sent 120 ms after the keystroke; its primary answers 80 ms later, its rows 400 ms later.
    type(view, 'roa');
    await advance(220);
    expect(titles()).toEqual(['Roadmap', 'Roadmap row']);
    expect(showsProgress()).toBe(true);

    await advance(320);
    expect(titles()).toEqual(['Roadmap', 'Roadmap row', 'Roadmap row 2']);
    expect(showsProgress()).toBe(false);
  });

  it('keeps the narrowed list next to the unavailable row when the typed search fails', async () => {
    const search = createSearch((lane) => {
      if (lane === 'bare') return { delayMs: 50, response: pages(ROADMAP, BUDGET) };
      if (lane === 'primary') return { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
      return { delayMs: 80, response: EMPTY };
    });
    const view = await openPanel(search);

    type(view, 'r');
    await advance(300);

    expect(titles()).toEqual(['Roadmap']);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
    expect(shows('findAndReplace.noResult')).toBe(false);
  });

  it('keeps only the kinds a failed request lacks when the answer lists no item', async () => {
    const search = createSearch((lane) => {
      if (lane === 'bare') return { delayMs: 50, response: pages(ROADMAP, BUDGET) };
      // The primary answers that no page matches; only the rows request fails.
      if (lane === 'primary') return { delayMs: 80, response: EMPTY };
      return { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
    });
    const view = await openPanel(search);

    type(view, 'ro');
    expect(titles()).toEqual(['Roadmap']);
    await advance(300);

    expect(titles()).toEqual([]);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
    expect(isBusy()).toBe(false);
    expect(shows('findAndReplace.noResult')).toBe(false);
  });

  it('keeps the provisional pages of a busy primary request, not the rows its rows request ruled out', async () => {
    const attempts = { primary: 0, rows: 0 };
    const search = createSearch((lane, query) => {
      if (lane === 'bare') return { delayMs: 50, response: EMPTY };
      if (query === 'ro') {
        return { delayMs: 80, response: lane === 'primary' ? pages(ROADMAP) : pages(row('Roadmap row')) };
      }

      attempts[lane] += 1;
      // `roa`: first the primary is asked to wait and no row matches, then no page matches and the
      // rows request fails.
      if (lane === 'primary') {
        return attempts.primary === 1
          ? { delayMs: 80, error: { code: ERROR_CODE.RETRY_LATER, message: 'retry later' } }
          : { delayMs: 80, response: EMPTY };
      }

      return attempts.rows === 1
        ? { delayMs: 80, response: EMPTY }
        : { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
    });
    const view = await openPanel(search);

    type(view, 'ro');
    await advance(300);
    expect(titles()).toEqual(['Roadmap', 'Roadmap row']);

    type(view, 'roa');
    expect(titles()).toEqual(['Roadmap', 'Roadmap row']);
    await advance(300);
    expect(titles()).toEqual(['Roadmap']);
    expect(busyRow()).not.toBeNull();
    expect(shows('findAndReplace.noResult')).toBe(false);

    // Sent again after the 3 s cooldown, it replaces the first attempt, which listed no item either.
    await advance(3_000);
    expect(attempts).toEqual({ primary: 2, rows: 2 });
    expect(titles()).toEqual(['Roadmap row']);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
  });

  it("keeps the previous attempt's answer when a retry lists no item, body-only hits too", async () => {
    const attempts = { primary: 0, rows: 0 };
    const failure: Reply = { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
    const search = createSearch((lane) => {
      if (lane === 'bare') return { delayMs: 50, response: EMPTY };
      attempts[lane] += 1;
      // First the rows request fails; on the retry the primary does, and no row matches.
      // Weekly notes matched `ro` in its body, which no provisional list keeps.
      if (lane === 'primary') {
        return attempts.primary === 1 ? { delayMs: 80, response: pages(ROADMAP, page('Weekly notes')) } : failure;
      }

      return attempts.rows === 1 ? failure : { delayMs: 80, response: EMPTY };
    });
    const view = await openPanel(search);

    type(view, 'ro');
    await advance(300);
    expect(titles()).toEqual(['Roadmap', 'Weekly notes']);

    await act(async () => {
      fireEvent.click(retryRow() as HTMLElement);
    });
    await advance(300);
    expect(attempts).toEqual({ primary: 2, rows: 2 });
    expect(titles()).toEqual(['Roadmap', 'Weekly notes']);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
  });

  it('takes a quick pick from the newest cached answer, so a refresh that lands after the keystroke gives its time', async () => {
    const before = reminder('Reminder 1 week', '2026-11-16T10:00:00Z', 'Nov 16, 10:00');
    const refreshed = reminder('Reminder 1 week', '2026-11-17T15:00:00Z', 'Nov 17, 15:00');
    let bareAnswers = 0;
    const search = createSearch((lane) => {
      if (lane === 'bare') {
        bareAnswers += 1;
        return bareAnswers === 1
          ? { delayMs: 50, response: { sections: [section(MentionSearchSectionKind.Dates, [before])] } }
          : { delayMs: 200, response: { sections: [section(MentionSearchSectionKind.Dates, [refreshed])] } };
      }

      if (lane === 'primary') return { delayMs: 30, error: { code: 500, message: 'Internal Server Error' } };
      return { delayMs: 30, response: EMPTY };
    });

    await openPanel(search);
    cleanup();
    await advance(MENTION_SEARCH_CACHE_FRESH_MS);

    // The next opening shows the stale bare answer while it refreshes it, and `re` is typed at once.
    const view = await openPanel(search, 0);

    expect(shows('Nov 16, 10:00')).toBe(true);
    type(view, 're');
    expect(shows('Nov 16, 10:00')).toBe(true);

    // The typed search fails at 150 ms, and the refresh lands at 200 ms.
    await advance(300);
    expect(bareAnswers).toBe(2);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
    expect(shows('Nov 16, 10:00')).toBe(false);
    expect(shows('Nov 17, 15:00')).toBe(true);

    await placeCaretAtEnd(view.editor);
    await pressKey('ArrowDown');
    await pressKey('Enter');
    expect(mockAddMark).toHaveBeenCalledWith(
      view.editor,
      expect.objectContaining({
        value: expect.objectContaining({ type: MentionType.Date, date: '2026-11-17T15:00:00Z' }),
      })
    );
  });

  it('takes a quick pick from a typed answer asked for after the cached bare one', async () => {
    const stale = reminder('Reminder 1 week', '2026-11-16T10:00:00Z', 'Nov 16, 10:00');
    const typed = reminder('Reminder 1 week', '2026-11-17T15:00:00Z', 'Nov 17, 15:00');
    let bareAnswers = 0;
    const search = createSearch((lane, query) => {
      if (lane === 'bare') {
        bareAnswers += 1;
        // The refresh of the next opening never answers.
        return bareAnswers === 1
          ? { delayMs: 50, response: { sections: [section(MentionSearchSectionKind.Dates, [stale])] } }
          : NEVER;
      }

      if (lane === 'rows') return { delayMs: 30, response: EMPTY };
      return query === 'r'
        ? { delayMs: 30, response: { sections: [section(MentionSearchSectionKind.Dates, [typed])] } }
        : NEVER;
    });

    await openPanel(search);
    cleanup();
    await advance(MENTION_SEARCH_CACHE_FRESH_MS);

    const view = await openPanel(search, 0);

    type(view, 'r');
    await advance(300);
    expect(shows('Nov 17, 15:00')).toBe(true);

    // `re` waits for its answer; its reminder is the one `r`'s answer gave, not the bare one.
    type(view, 're');
    expect(shows('Nov 16, 10:00')).toBe(false);
    expect(shows('Nov 17, 15:00')).toBe(true);
  });

  it('shows no server answer when none of the typed requests answered, so the report counts none', async () => {
    const search = createSearch((lane) =>
      lane === 'bare'
        ? { delayMs: 50, response: pages(ROADMAP, BUDGET) }
        : { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } }
    );

    await openPanel(search);
    cleanup();
    // Reopened at once, the fresh bare answer is painted from the cache, with no request.
    const view = await openPanel(search, 0);

    type(view, 'r');
    await advance(300);
    expect(titles()).toEqual(['Roadmap']);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');

    cleanup();
    await act(async () => {
      await Promise.resolve();
    });

    const sessions = mockReport.mock.calls.map(([, session]) => session as MentionPickerSession);

    expect(sessions).toHaveLength(2);
    expect(sessions[0].server_ms).toEqual(expect.any(Number));
    expect(sessions[1].server_ms).toBeUndefined();
    expect(sessions[1].time_to_first_paint_ms).toEqual(expect.any(Number));
  });

  it('shows a cached answer for the query rather than an answer of its own that lists no item', async () => {
    const search = createSearch((lane) => {
      if (lane === 'bare') return { delayMs: 50, response: EMPTY };
      // The primary request fails, and no row matches.
      if (lane === 'primary') return { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
      return { delayMs: 80, response: EMPTY };
    });
    const view = await openPanel(search);

    type(view, 'ro');
    await advance(130);

    // Another flight stores the answer to `ro` while this one is pending, body-only hit included.
    const requests = search.mock.calls.map(([request]) => request).filter((request) => request.query === 'ro');

    expect(requests).toHaveLength(2);
    await act(async () => {
      setCachedMentionSections(
        buildMentionSearchRequestsCacheKey(requests, { workspaceId: 'workspace' }),
        pages(ROADMAP, page('Weekly notes')).sections
      );
    });
    await advance(200);
    expect(titles()).toEqual(['Roadmap', 'Weekly notes']);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
  });

  it('keeps a one-letter query local under the contract scheduler: narrowed at once, or "No result"', async () => {
    localStorage.setItem(MENTION_SCHEDULER_MODE_OVERRIDE_KEY, 'contract');
    localStorage.setItem(MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY, 'true');

    const search = createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: pages(ROADMAP, BUDGET) } : NEVER));
    const view = await openPanel(search);

    type(view, 'r');
    expect(titles()).toEqual(['Roadmap']);
    await advance(1_000);
    expect(titles()).toEqual(['Roadmap']);
    expect(showsProgress()).toBe(false);
    expect(shows('findAndReplace.noResult')).toBe(false);

    // A letter nothing matches waits for no answer, so it says so at once.
    commits = [];
    type(view, 'x');
    expect(titles()).toEqual([]);
    expect(isBusy()).toBe(false);
    expect(shows('findAndReplace.noResult')).toBe(true);
    expect(commits.every(({ noResult }) => noResult)).toBe(true);
    await advance(1_000);
    expect(typedQueries(search)).toEqual([]);
  });

  it('says "No result" only once the server answered that nothing matches', async () => {
    const search = createSearch((lane) =>
      lane === 'bare' ? { delayMs: 50, response: pages(ROADMAP) } : { delayMs: 80, response: EMPTY }
    );
    const view = await openPanel(search);

    type(view, 'ro');
    expect(titles()).toEqual(['Roadmap']);
    await advance(300);
    expect(titles()).toEqual([]);
    expect(shows('findAndReplace.noResult')).toBe(true);

    // Nothing on screen matches `zz`: the skeleton waits for its answer, never a "No result" first.
    commits = [];
    type(view, 'zz');
    expect(isBusy()).toBe(true);
    expect(commits.some(({ noResult }) => noResult)).toBe(false);
    await advance(300);
    expect(shows('findAndReplace.noResult')).toBe(true);
  });

  it('drops a view the user loses access to from the provisional list at once', async () => {
    const eventEmitter = new EventEmitter();
    const search = createSearch((lane) =>
      lane === 'bare' ? { delayMs: 50, response: pages(ROADMAP, ROAD_TRIP) } : NEVER
    );

    mockEditorContext.eventEmitter = eventEmitter;

    const view = await openPanel(search);

    type(view, 'ro');
    expect(titles()).toEqual(['Roadmap', 'Road trip']);

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'Roadmap' });
    });
    expect(titles()).toEqual(['Road trip']);

    type(view, 'roa');
    expect(titles()).toEqual(['Road trip']);
  });

  // PERMISSION_CHANGED names no view the user lost (a space's access or members, a role, a group),
  // so no answer cached before it can be cleaned of one.
  it('narrows no answer asked for before an access change that names no view', async () => {
    const eventEmitter = new EventEmitter();
    let lostRoadmap = false;
    // Once the user lost Roadmap, the bare answer leaves it out, and comes slowly.
    const bareReply = (): Reply =>
      lostRoadmap ? { delayMs: 400, response: pages(BUDGET) } : { delayMs: 50, response: pages(ROADMAP, BUDGET) };
    const search = createSearch((lane, query) => {
      if (lane === 'bare') return bareReply();
      if (lane === 'rows') return { delayMs: 50, response: EMPTY };
      if (query === 'ro') return { delayMs: 50, response: pages(ROADMAP, ROAD_TRIP) };
      return { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
    });

    mockEditorContext.eventEmitter = eventEmitter;

    const first = await openPanel(search);

    type(first, 'ro');
    await advance(300);
    expect(titles()).toEqual(['Roadmap', 'Road trip']);
    cleanup();

    lostRoadmap = true;
    eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space', reason: 0 });

    const view = await openPanel(search, 0);

    // The stale bare answer shows while it is asked for again, as before.
    expect(titles()).toEqual(['Roadmap', 'Budget']);

    // Neither it nor the cached answer to `ro` feeds the keystroke, nor stays when the search fails.
    type(view, 'roa');
    expect(titles()).toEqual([]);
    await advance(300);
    expect(retryRow()).not.toBeNull();
    expect(titles()).toEqual([]);

    // The bare answer asked for since does.
    await advance(200);
    type(view, 'bu');
    expect(titles()).toEqual(['Budget']);
  });

  it('narrows no answer whose request was in flight when the access changed', async () => {
    const eventEmitter = new EventEmitter();
    const search = createSearch((lane) =>
      lane === 'bare' ? { delayMs: 300, response: pages(ROADMAP, BUDGET) } : NEVER
    );

    mockEditorContext.eventEmitter = eventEmitter;

    const view = await openPanel(search);

    eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space', reason: 0 });
    await advance(300);
    // The server answered for the access before the change: shown, as any answer is.
    expect(titles()).toEqual(['Roadmap', 'Budget']);

    type(view, 'r');
    expect(titles()).toEqual([]);
  });

  // Lists on screen that no cached answer of what is typed backs: a provisional list, the items
  // kept next to Retry, and the answer of one lane while the other is pending.
  describe('a list on screen from before an access change that names no view', () => {
    // The bare answer comes at once; typed searches fail.
    const failingTypedSearch = () =>
      createSearch((lane) => {
        if (lane === 'bare') return { delayMs: 50, response: pages(ROADMAP, BUDGET) };
        if (lane === 'rows') return { delayMs: 50, response: EMPTY };
        return { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
      });

    async function changeAccess(eventEmitter: EventEmitter) {
      await act(async () => {
        eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space', reason: 0 });
      });
    }

    it('leaves the provisional list, which narrows into no later keystroke', async () => {
      const eventEmitter = new EventEmitter();

      mockEditorContext.eventEmitter = eventEmitter;

      const view = await openPanel(failingTypedSearch());

      type(view, 'r');
      expect(titles()).toEqual(['Roadmap']);

      await changeAccess(eventEmitter);
      expect(titles()).toEqual([]);

      type(view, 'ro');
      expect(titles()).toEqual([]);
      await advance(300);
      expect(retryRow()).not.toBeNull();
      expect(titles()).toEqual([]);
    });

    it('keeps no item next to Retry', async () => {
      const eventEmitter = new EventEmitter();

      mockEditorContext.eventEmitter = eventEmitter;

      const view = await openPanel(failingTypedSearch());

      type(view, 'ro');
      await advance(300);
      expect(retryRow()).not.toBeNull();
      expect(titles()).toEqual(['Roadmap']);

      await changeAccess(eventEmitter);
      expect(retryRow()).not.toBeNull();
      expect(titles()).toEqual([]);

      type(view, 'roa');
      expect(titles()).toEqual([]);
      await advance(300);
      expect(retryRow()).not.toBeNull();
      expect(titles()).toEqual([]);
    });

    it('shows the answer of a lane asked for before it, which narrows into no later keystroke', async () => {
      const eventEmitter = new EventEmitter();
      let changed = false;
      // Before the change, the rows lane answers `ro` slowly; after it, typed searches fail.
      const search = createSearch((lane, query) => {
        if (lane === 'bare') return { delayMs: 50, response: pages(ROADMAP, BUDGET) };
        if (changed) return { delayMs: 80, error: { code: 500, message: 'Internal Server Error' } };
        if (lane === 'rows') return { delayMs: 2_000, response: EMPTY };
        return query === 'ro' ? { delayMs: 100, response: pages(ROADMAP, ROAD_TRIP) } : NEVER;
      });

      mockEditorContext.eventEmitter = eventEmitter;

      const view = await openPanel(search);

      type(view, 'ro');
      await advance(130);
      expect(typedQueries(search)).toEqual(['ro', 'ro']);
      // Not answered yet: the bare answer, narrowed.
      expect(titles()).toEqual(['Roadmap']);

      changed = true;
      await changeAccess(eventEmitter);
      await advance(110);
      // The primary lane's answer, shown as any answer is, while the rows lane is pending.
      expect(titles()).toEqual(['Roadmap', 'Road trip']);

      type(view, 'roa');
      expect(titles()).toEqual([]);
      await advance(300);
      expect(retryRow()).not.toBeNull();
      expect(titles()).toEqual([]);
    });
  });

  it('reports a pick from the provisional list as a cached one, and the first paint with it', async () => {
    const search = createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: pages(ROADMAP, BUDGET) } : NEVER));
    const view = await openPanel(search);

    type(view, 'r');
    await placeCaretAtEnd(view.editor);
    await pressKey('ArrowDown');
    expect(highlighted()).toEqual(['Roadmap']);
    await pressKey('Enter');
    expect(mockAddMark).toHaveBeenCalledWith(
      view.editor,
      expect.objectContaining({ value: expect.objectContaining({ type: MentionType.PageRef, page_id: 'Roadmap' }) })
    );

    cleanup();
    await act(async () => {
      await Promise.resolve();
    });

    const session = mockReport.mock.calls[0]?.[1] as MentionPickerSession | undefined;

    expect(session).toMatchObject({ outcome: 'selected', selected_rank: 1, selected_section: 'pages' });
    expect(session?.selected_source).toBe('cache');
    expect(session?.time_to_first_paint_ms).toEqual(expect.any(Number));
  });

  describe('the highlight', () => {
    it('stays on its item through a merge that re-tiers the list, without the default highlight', async () => {
      const search = createSearch((lane, query) => {
        if (lane === 'bare') return { delayMs: 50, response: pages(ROADMAP, ROAD_TRIP) };
        if (lane === 'rows') return { delayMs: 400, response: pages(row(query)) };
        return { delayMs: 80, response: pages(ROADMAP, ROAD_TRIP) };
      });
      const view = await openPanel(search);

      type(view, 'roa');
      expect(highlighted()).toEqual([]);
      await advance(300);
      await placeCaretAtEnd(view.editor);
      await pressKey('ArrowDown');
      await pressKey('ArrowDown');
      expect(highlighted()).toEqual(['Road trip']);

      // The exact-title row merges in above both pages.
      await advance(400);
      expect(titles()).toEqual(['roa', 'Roadmap', 'Road trip']);
      expect(highlighted()).toEqual(['Road trip']);

      await pressKey('Enter');
      expect(mockAddMark).toHaveBeenCalledWith(
        view.editor,
        expect.objectContaining({ value: expect.objectContaining({ page_id: 'Road trip' }) })
      );

      // A keystroke ends the navigation, as before.
      type(view, 'road');
      expect(highlighted()).toEqual([]);
    });

    describe('with the default highlight on', () => {
      beforeEach(() => {
        localStorage.setItem(MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY, 'true');
      });

      it('highlights the first option, and follows the top of the list until an arrow key holds it', async () => {
        const search = createSearch((lane, query) => {
          if (lane === 'bare') return { delayMs: 50, response: pages(ROADMAP, ROAD_TRIP, BUDGET) };
          if (lane === 'rows') return { delayMs: 400, response: pages(row(query)) };
          // The server puts Road trip first inside the tier both titles share.
          return { delayMs: 80, response: pages(ROAD_TRIP, ROADMAP) };
        });
        const view = await openPanel(search);

        expect(highlighted()).toEqual(['Roadmap']);

        type(view, 'ro');
        expect(highlighted()).toEqual(['Roadmap']);
        await advance(220);
        expect(titles()).toEqual(['Road trip', 'Roadmap']);
        expect(highlighted()).toEqual(['Road trip']);

        // Held on Roadmap, it stays there when the exact-title row merges in at the top.
        await placeCaretAtEnd(view.editor);
        await pressKey('ArrowDown');
        expect(highlighted()).toEqual(['Roadmap']);
        await advance(400);
        expect(titles()).toEqual(['ro', 'Road trip', 'Roadmap']);
        expect(highlighted()).toEqual(['Roadmap']);

        await pressKey('Enter');
        expect(mockAddMark).toHaveBeenCalledWith(
          view.editor,
          expect.objectContaining({ value: expect.objectContaining({ page_id: 'Roadmap' }) })
        );

        // The next keystroke releases it to the top of the narrowed list.
        type(view, 'roa');
        expect(titles()[0]).toBe('Road trip');
        expect(highlighted()).toEqual(['Road trip']);
      });

      it('lets Enter insert the highlighted first option without an arrow key', async () => {
        const search = createSearch((lane) =>
          lane === 'bare' ? { delayMs: 50, response: pages(ROADMAP, BUDGET) } : NEVER
        );
        const view = await openPanel(search);

        type(view, 'bu');
        await placeCaretAtEnd(view.editor);
        expect(highlighted()).toEqual(['Budget']);
        await pressKey('Enter');
        expect(mockAddMark).toHaveBeenCalledWith(
          view.editor,
          expect.objectContaining({ value: expect.objectContaining({ page_id: 'Budget' }) })
        );
      });
    });
  });

  describe('with the switch off', () => {
    beforeEach(() => {
      localStorage.removeItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY);
      localStorage.setItem(MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY, 'true');
    });

    it('blanks the list behind the skeleton on a keystroke, as before', async () => {
      const search = createSearch((lane) =>
        lane === 'bare' ? { delayMs: 50, response: pages(ROADMAP, BUDGET) } : NEVER
      );
      const view = await openPanel(search);

      expect(highlighted()).toEqual([]);
      commits = [];
      type(view, 'r');
      expect(titles()).toEqual([]);
      expect(isBusy()).toBe(true);
      expect(showsProgress()).toBe(false);
      expect(commits.map(({ options }) => options)).toContain(0);
    });

    it("keeps an older server's order", async () => {
      mockPanelContext.searchText = 'roadmap';
      mockEditorContext.searchMentions = createSearch((lane) => ({
        delayMs: 80,
        response: lane === 'primary' ? pages(page('Weekly notes'), page('Roadmap 2026')) : EMPTY,
      }));
      renderPanel();
      await advance(300);

      expect(titles()).toEqual(['Weekly notes', 'Roadmap 2026']);
    });
  });
});
