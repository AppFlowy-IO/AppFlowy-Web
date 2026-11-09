import { EventEmitter } from 'events';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
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
import { MENTION_BARE_DEADLINE_MS, MENTION_TYPED_DEADLINE_MS } from '../mentionRequestLanes';
import {
  clearMentionSearchCacheForTests,
  getCachedMentionSections,
  MENTION_SEARCH_CACHE_FRESH_MS,
} from '../mentionSearchCache';
import { buildMentionSearchRequestsCacheKey, mergeMentionSearchResponses } from '../mentionUtils';

const mockAddMark = jest.fn();

const mockPanelContext = {
  activePanel: PanelType.Mention,
  isPanelOpen: (panel: PanelType) => panel === PanelType.Mention,
  panelPosition: { top: 0, left: 0 },
  searchText: 'road',
  closePanel: jest.fn(),
  removeContent: jest.fn(),
};
const mockEditorContext: Record<string, unknown> = { workspaceId: 'workspace' };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: {} }));
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

type Lane = 'primary' | 'rows';
// `partial`: every item, with `partial` set because breadcrumb paths were load-shed.
// `failed`: a degraded keyword search, which fails the requested section and sets `partial`.
type Outcome = 'complete' | 'partial' | 'failed' | 'reject';

interface Step {
  delayMs: number;
  outcome: Outcome;
}

type SearchPlan = Record<Lane, Step[]>;

const STEP_MS = 10;
const complete = (delayMs: number): Step => ({ delayMs, outcome: 'complete' });
const partial = (delayMs: number): Step => ({ delayMs, outcome: 'partial' });
const failed = (delayMs: number): Step => ({ delayMs, outcome: 'failed' });
const reject = (delayMs: number): Step => ({ delayMs, outcome: 'reject' });

function pageItem(title: string): MentionSearchResultItem {
  return { kind: MentionTargetKind.Page, object_id: title, title, mention: { type: MentionTargetKind.Page, page_id: title } };
}

function rowItem(title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.DatabaseRow,
    object_id: title,
    title,
    mention: { type: MentionTargetKind.DatabaseRow, database_id: 'database', database_view_id: 'grid', row_id: title },
  };
}

function databaseItem(title: string, databaseId: string, viewId: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Database,
    object_id: databaseId,
    title,
    database_id: databaseId,
    database_view_id: viewId,
    mention: { type: MentionTargetKind.Database, database_id: databaseId, database_view_id: viewId },
  };
}

// Date and reminder quick picks and links carry no object id, as the server builds them.
function dateItem(kind: MentionTargetKind.Date | MentionTargetKind.Reminder, title: string): MentionSearchResultItem {
  const date = '2026-11-10T09:00:00+08:00';

  return { kind, title, subtitle: date, mention: { type: MentionTargetKind.Date, date, include_time: false } };
}

function linkItem(text: string): MentionSearchResultItem {
  const url = `https://${text}`;

  return {
    kind: MentionTargetKind.ExternalLink,
    title: text,
    subtitle: url,
    mention: { type: MentionType.externalLink, url },
  };
}

function personItem(id: string, name: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: id,
    title: name,
    mention: { type: MentionTargetKind.Person, person_id: id, person_name: name, page_id: 'page' },
  };
}

function respond(lane: Lane, query: string, outcome: Outcome): MentionSearchResponse {
  if (outcome === 'failed') {
    return { sections: [failedSection(MentionSearchSectionKind.Pages)], partial: true };
  }

  // Search returns typed database rows inside the Pages section, each keeping its row kind.
  const item = lane === 'primary' ? pageItem(`Page for ${query}`) : rowItem(`${outcome} row for ${query}`);

  return {
    sections: [section(MentionSearchSectionKind.Pages, [item])],
    partial: outcome === 'partial' || undefined,
  };
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ready' };
}

function failedSection(kind: MentionSearchSectionKind): MentionSearchSection {
  return { kind, title: kind, items: [], has_more: false, status: 'failed', message: 'keyword results are incomplete' };
}

function isRowRequest(request: MentionSearchRequest) {
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow;
}

function laneOf(request: MentionSearchRequest): Lane {
  return isRowRequest(request) ? 'rows' : 'primary';
}

// What the HTTP layer rejects with once a request's signal aborts.
function cancelledError() {
  return { code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' };
}

// Answers after `delayMs`, or rejects as cancelled as soon as `signal` aborts, like axios.
function answerAfter(delayMs: number, signal: AbortSignal | undefined, answer: () => MentionSearchResponse) {
  return new Promise<MentionSearchResponse>((resolve, rejectSearch) => {
    if (signal?.aborted) {
      rejectSearch(cancelledError());
      return;
    }

    const timer = setTimeout(() => {
      try {
        resolve(answer());
      } catch (error) {
        rejectSearch(error);
      }
    }, delayMs);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        rejectSearch(cancelledError());
      },
      { once: true }
    );
  });
}

function createSearch(plans: Record<string, SearchPlan>) {
  const queues = new Map(
    Object.entries(plans).map(([query, plan]) => [query, { primary: [...plan.primary], rows: [...plan.rows] }])
  );

  return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
    const query = request.query ?? '';
    const lane = laneOf(request);
    const step = queues.get(query)?.[lane].shift();

    if (!step) return Promise.reject(new Error(`unplanned ${lane} search for "${query}"`));

    return answerAfter(step.delayMs, options?.signal, () => {
      if (step.outcome === 'reject') throw new Error(`${lane} search failed`);
      return respond(lane, query, step.outcome);
    });
  });
}

type SearchMock = ReturnType<typeof createSearch>;
type Answer = MentionSearchResponse | { error: unknown };

// Answers each lane's requests in order with a response, or rejects with `error`.
function createAnswerSearch(answers: Record<Lane, Array<[delayMs: number, answer: Answer]>>) {
  const queues = { primary: [...answers.primary], rows: [...answers.rows] };

  return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
    const lane = laneOf(request);
    const next = queues[lane].shift();

    if (!next) return Promise.reject(new Error(`unplanned ${lane} search`));

    const [delayMs, answer] = next;

    return answerAfter(delayMs, options?.signal, () => {
      if ('error' in answer) throw answer.error;
      return answer;
    });
  });
}

// Answers each query's requests from its own lanes, as createAnswerSearch does for one query.
function createAnswerSearchByQuery(answers: Record<string, Record<Lane, Array<[delayMs: number, answer: Answer]>>>) {
  const searches = new Map(Object.entries(answers).map(([query, lanes]) => [query, createAnswerSearch(lanes)]));

  return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
    const search = searches.get(request.query ?? '');

    return search ? search(request, options) : Promise.reject(new Error(`unplanned search for "${request.query}"`));
  });
}

// The cache key of the first request group sent for `query`.
function sentCacheKey(search: SearchMock, query: string) {
  const requests = search.mock.calls.map(([request]) => request).filter((request) => request.query === query);

  return buildMentionSearchRequestsCacheKey(requests.slice(0, query ? 2 : 1), { workspaceId: 'workspace' });
}

function sentOptions(search: SearchMock, query: string) {
  return search.mock.calls.filter(([request]) => request.query === query).map(([, options]) => options);
}

function createFixedSearch(responses: Record<Lane, [delayMs: number, response: MentionSearchResponse]>) {
  return jest.fn((request: MentionSearchRequest) => {
    const [delayMs, response] = responses[isRowRequest(request) ? 'rows' : 'primary'];

    return new Promise<MentionSearchResponse>((resolve) => {
      setTimeout(() => resolve(response), delayMs);
    });
  });
}

function renderPanel() {
  const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });
  const tree = () => (
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@road' }] }]}>
      <Editable data-testid='editor' />
      <MentionPanel notifyOnInsert={false} />
    </Slate>
  );
  const view = render(tree());

  return { editor, rerender: () => view.rerender(tree()) };
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function shows(text: string) {
  return screen.queryByText(text) !== null;
}

function isBusy() {
  return document.querySelector('[aria-busy="true"]') !== null;
}

function isSelected(text: string) {
  return screen.getByText(text).closest('button')?.getAttribute('data-selected') === 'true';
}

function isSelectedIn(kind: MentionSearchSectionKind, text: string) {
  const sectionElement = document.querySelector<HTMLElement>(`[data-section-kind="${kind}"]`);

  return (
    sectionElement !== null &&
    within(sectionElement).getByText(text).closest('button')?.getAttribute('data-selected') === 'true'
  );
}

function highlightedCount() {
  return document.querySelectorAll('[data-option-index][data-selected="true"]').length;
}

function moreResultsButton() {
  return screen.getByText('document.mention.moreResults').closest('button');
}

// The "Suggestions unavailable · Retry" (or "You're offline · Retry") option.
function retryRow() {
  return document.querySelector<HTMLElement>('[data-testid="mention-panel-retry"]');
}

// The "Busy, retrying in N s" row.
function busyRow() {
  return document.querySelector<HTMLElement>('[data-testid="mention-panel-busy"]');
}

function showsNoResult() {
  return shows('findAndReplace.noResult');
}

async function placeCaretAtEnd(editor: Editor) {
  await act(async () => {
    Transforms.select(editor, Editor.end(editor, []));
  });
}

async function pressKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('editor'), { key });
  });
}

async function measureDelivery(isComplete: () => boolean, limitMs = 2000) {
  let firstResultsMs: number | undefined;
  let completeResultsMs: number | undefined;

  for (let now = STEP_MS; now <= limitMs && completeResultsMs === undefined; now += STEP_MS) {
    await advance(STEP_MS);

    if (firstResultsMs === undefined && document.querySelector('[data-option-index]')) firstResultsMs = now;
    if (isComplete()) completeResultsMs = now;
  }

  return { firstResultsMs, completeResultsMs };
}

describe('MentionPanel typed search delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    clearMentionSearchCacheForTests();
    localStorage.clear();
    mockPanelContext.searchText = 'road';
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
    mockEditorContext.eventEmitter = undefined;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // Times are virtual ms from opening the panel, including the 120 ms typed-search debounce.
  it.each([
    { name: 'S1 primary 80 / rows 80', plan: { primary: [complete(80)], rows: [complete(80)] }, first: 200, done: 200 },
    { name: 'S2 primary 80 / rows 400', plan: { primary: [complete(80)], rows: [complete(400)] }, first: 200, done: 520 },
    {
      name: 'S3 rows failed, retry complete',
      plan: { primary: [complete(80)], rows: [failed(80), complete(80)] },
      first: 200,
      done: 780,
    },
    { name: 'S5 primary 400 / rows 80', plan: { primary: [complete(400)], rows: [complete(80)] }, first: 520, done: 520 },
  ])('$name: first results at $first ms, complete results at $done ms', async ({ plan, first, done }) => {
    const search = createSearch({ road: plan });

    mockEditorContext.searchMentions = search;
    renderPanel();

    const timeline = await measureDelivery(() => shows('Page for road') && shows('complete row for road'));

    expect(timeline).toEqual({ firstResultsMs: first, completeResultsMs: done });
    expect(search).toHaveBeenCalledTimes(plan.primary.length + plan.rows.length);
  });

  it('S4 rows reject: shows the primary results with the unavailable row, and never retries the rows', async () => {
    const search = createSearch({ road: { primary: [complete(80)], rows: [reject(80)] } });

    mockEditorContext.searchMentions = search;
    renderPanel();
    await advance(200);

    expect(shows('Page for road')).toBe(true);
    expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
    expect(showsNoResult()).toBe(false);

    await advance(2_000);
    expect(search).toHaveBeenCalledTimes(2);
    expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeUndefined();
  });

  it.each([
    {
      name: 'its primary response arrives after the query changed',
      oldPlan: { primary: [complete(400)], rows: [complete(400)] },
      changeAtMs: 300,
    },
    {
      name: 'its rows retry finishes after the query changed',
      oldPlan: { primary: [complete(80)], rows: [failed(80), complete(300)] },
      changeAtMs: 720,
    },
  ])('never lets a stale search overwrite newer results when $name', async ({ oldPlan, changeAtMs }) => {
    const search = createSearch({ road: oldPlan, roadmap: { primary: [complete(80)], rows: [complete(80)] } });

    mockEditorContext.searchMentions = search;
    const { rerender } = renderPanel();

    await advance(changeAtMs);
    mockPanelContext.searchText = 'roadmap';
    rerender();

    for (let now = changeAtMs + STEP_MS; now <= 2000; now += STEP_MS) {
      await advance(STEP_MS);

      expect(shows('Page for road')).toBe(false);
      expect(shows('partial row for road')).toBe(false);
      expect(shows('complete row for road')).toBe(false);
    }

    expect(shows('Page for roadmap')).toBe(true);
    expect(shows('complete row for roadmap')).toBe(true);
  });

  it.each([
    {
      name: 'rows arrive after the primary results',
      plan: { primary: [complete(80)], rows: [complete(400)] },
      doneAt: 520,
      cachedRows: 'complete' as const,
    },
    {
      // Path load-shedding sets `partial` alone: two requests, no retry, and the answer is cached.
      name: 'rows are partial only because their paths were shed',
      plan: { primary: [complete(80)], rows: [partial(80)] },
      doneAt: 200,
      cachedRows: 'partial' as const,
    },
    {
      name: 'rows fail until the retry',
      plan: { primary: [complete(80)], rows: [failed(80), complete(80)] },
      doneAt: 780,
      cachedRows: 'complete' as const,
    },
    {
      name: 'the rows retry fails again',
      plan: { primary: [complete(80)], rows: [failed(80), failed(80)] },
      doneAt: 780,
      cachedRows: undefined,
    },
  ])('caches only a complete answer when $name', async ({ plan, doneAt, cachedRows }) => {
    const search = createSearch({ road: plan });

    mockEditorContext.searchMentions = search;
    renderPanel();
    await advance(doneAt - STEP_MS);

    const cacheKey = buildMentionSearchRequestsCacheKey(
      search.mock.calls.slice(0, 2).map(([request]) => request),
      { workspaceId: 'workspace' }
    );

    expect(getCachedMentionSections(cacheKey)).toBeUndefined();

    await advance(STEP_MS);

    expect(shows('Page for road')).toBe(true);
    expect(getCachedMentionSections(cacheKey)).toEqual(
      cachedRows
        ? mergeMentionSearchResponses([respond('primary', 'road', 'complete'), respond('rows', 'road', cachedRows)])
            .sections
        : undefined
    );
    if (cachedRows) {
      expect(shows(`${cachedRows} row for road`)).toBe(true);
      expect(retryRow()).toBeNull();
    } else {
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
    }

    await advance(2_000);
    expect(search).toHaveBeenCalledTimes(plan.primary.length + plan.rows.length);
  });

  it('drops the loading skeleton once primary results render', async () => {
    mockEditorContext.searchMentions = createSearch({ road: { primary: [complete(80)], rows: [complete(400)] } });
    renderPanel();

    await advance(190);
    expect(isBusy()).toBe(true);

    await advance(STEP_MS);
    expect(shows('Page for road')).toBe(true);
    expect(isBusy()).toBe(false);
  });

  it('keeps loading instead of flashing no results while rows are pending behind an empty primary', async () => {
    mockEditorContext.searchMentions = createFixedSearch({
      primary: [80, { sections: [section(MentionSearchSectionKind.Pages, [])] }],
      rows: [400, respond('rows', 'road', 'complete')],
    });
    renderPanel();

    for (let now = STEP_MS; now < 520; now += STEP_MS) {
      await advance(STEP_MS);

      expect(isBusy()).toBe(true);
      expect(shows('findAndReplace.noResult')).toBe(false);
    }

    await advance(STEP_MS);
    expect(shows('complete row for road')).toBe(true);
    expect(isBusy()).toBe(false);
  });

  it('keeps the keyboard selection on the same option when rows merge in', async () => {
    const today: MentionSearchResultItem = {
      kind: MentionTargetKind.Date,
      object_id: 'today',
      title: 'Today',
      mention: { type: MentionTargetKind.Date, start: '2026-10-21T00:00:00.000Z' },
    };

    Element.prototype.scrollIntoView = jest.fn();
    mockEditorContext.searchMentions = createFixedSearch({
      primary: [
        80,
        {
          sections: [
            section(MentionSearchSectionKind.Pages, [pageItem('Page for road')]),
            section(MentionSearchSectionKind.Dates, [today]),
          ],
        },
      ],
      rows: [400, respond('rows', 'road', 'complete')],
    });
    const { editor } = renderPanel();

    await advance(200);
    await act(async () => {
      Transforms.select(editor, Editor.end(editor, []));
    });
    await pressKey('ArrowDown');
    await pressKey('ArrowDown');
    expect(isSelected('Today')).toBe(true);

    await advance(320);
    expect(shows('complete row for road')).toBe(true);
    expect(isSelected('Today')).toBe(true);
    expect(isSelected('complete row for road')).toBe(false);

    await pressKey('Enter');
    expect(mockAddMark).toHaveBeenCalledWith(
      editor,
      expect.objectContaining({ value: expect.objectContaining({ type: MentionType.Date }) })
    );
  });

  describe('keyboard highlight follows its item, not its position', () => {
    beforeEach(() => {
      Element.prototype.scrollIntoView = jest.fn();
    });

    it('keeps a highlighted database when rows merge into Pages ahead of it, and Enter inserts it', async () => {
      mockEditorContext.searchMentions = createFixedSearch({
        primary: [
          80,
          {
            sections: [
              section(MentionSearchSectionKind.Pages, [pageItem('Road page')]),
              section(MentionSearchSectionKind.Databases, [databaseItem('Road database', 'dbX', 'X-grid')]),
            ],
          },
        ],
        rows: [400, { sections: [section(MentionSearchSectionKind.Pages, [rowItem('Road row')])] }],
      });
      const { editor } = renderPanel();

      await advance(200);
      await placeCaretAtEnd(editor);
      await pressKey('ArrowDown');
      await pressKey('ArrowDown');
      expect(isSelected('Road database')).toBe(true);

      // The rows land between the page and the folded-in database.
      await advance(320);
      expect(shows('Road row')).toBe(true);
      expect(isSelected('Road database')).toBe(true);
      expect(isSelected('Road row')).toBe(false);
      expect(highlightedCount()).toBe(1);

      await pressKey('Enter');
      expect(mockAddMark).toHaveBeenCalledTimes(1);
      expect(mockAddMark).toHaveBeenCalledWith(
        editor,
        expect.objectContaining({ value: expect.objectContaining({ database_id: 'dbX', database_view_id: 'X-grid' }) })
      );
    });

    it('never hands a highlight to the "N more" row when more than 4 pages arrive ahead of it', async () => {
      mockEditorContext.searchMentions = createFixedSearch({
        primary: [
          80,
          {
            sections: [
              section(MentionSearchSectionKind.Dates, [
                dateItem(MentionTargetKind.Date, 'Today'),
                dateItem(MentionTargetKind.Date, 'Tomorrow'),
                dateItem(MentionTargetKind.Date, 'Yesterday'),
                dateItem(MentionTargetKind.Reminder, 'Reminder tomorrow 9 AM'),
              ]),
              section(MentionSearchSectionKind.Links, [linkItem('road.example')]),
            ],
          },
        ],
        rows: [
          400,
          {
            sections: [
              section(
                MentionSearchSectionKind.Pages,
                [1, 2, 3, 4, 5].map((row) => rowItem(`Row ${row}`))
              ),
            ],
          },
        ],
      });
      const { editor } = renderPanel();

      await advance(200);
      await placeCaretAtEnd(editor);
      await pressKey('ArrowUp');
      expect(isSelected('road.example')).toBe(true);

      // Five rows add a Pages section, collapsed to four rows and "1 more", above the link.
      await advance(320);
      expect(shows('Row 4')).toBe(true);
      expect(shows('Row 5')).toBe(false);
      expect(moreResultsButton()?.getAttribute('data-selected')).toBeNull();
      expect(isSelected('road.example')).toBe(true);
      expect(highlightedCount()).toBe(1);

      await pressKey('Enter');
      expect(shows('Row 5')).toBe(false);
      expect(mockAddMark).toHaveBeenCalledWith(
        editor,
        expect.objectContaining({
          value: expect.objectContaining({ type: MentionType.externalLink, url: 'https://road.example' }),
        })
      );
    });

    it('resets to the first option when the highlighted item moves behind "N more"', async () => {
      mockEditorContext.searchMentions = createFixedSearch({
        primary: [
          80,
          {
            sections: [
              section(MentionSearchSectionKind.Pages, [pageItem('Page 1'), pageItem('Page 2'), pageItem('Page 3')]),
              section(MentionSearchSectionKind.Databases, [databaseItem('Road database', 'dbX', 'X-grid')]),
            ],
          },
        ],
        rows: [400, { sections: [section(MentionSearchSectionKind.Pages, [rowItem('Row 1'), rowItem('Row 2')])] }],
      });
      const { editor } = renderPanel();

      await advance(200);
      await placeCaretAtEnd(editor);
      await pressKey('ArrowUp');
      expect(isSelected('Road database')).toBe(true);

      // Pages now hold six items: the database is the second one hidden behind "2 more".
      await advance(320);
      expect(shows('Road database')).toBe(false);
      expect(isSelected('Page 1')).toBe(true);
      expect(isSelected('Row 1')).toBe(false);
      expect(moreResultsButton()?.getAttribute('data-selected')).toBeNull();
      expect(highlightedCount()).toBe(1);

      await pressKey('Enter');
      expect(mockAddMark).toHaveBeenCalledWith(
        editor,
        expect.objectContaining({ value: expect.objectContaining({ type: MentionType.PageRef, page_id: 'Page 1' }) })
      );
    });

    it('moves the highlight from "N more" onto the first page it reveals', async () => {
      mockEditorContext.searchMentions = createFixedSearch({
        primary: [
          80,
          {
            sections: [
              section(
                MentionSearchSectionKind.Pages,
                [1, 2, 3, 4, 5, 6].map((page) => pageItem(`Page ${page}`))
              ),
            ],
          },
        ],
        rows: [80, { sections: [] }],
      });
      const { editor } = renderPanel();

      await advance(200);
      await placeCaretAtEnd(editor);
      await pressKey('ArrowUp');
      expect(moreResultsButton()?.getAttribute('data-selected')).toBe('true');

      await pressKey('Enter');
      expect(shows('Page 6')).toBe(true);
      expect(isSelected('Page 5')).toBe(true);
      expect(highlightedCount()).toBe(1);
      expect(mockAddMark).not.toHaveBeenCalled();

      await pressKey('Enter');
      expect(mockAddMark).toHaveBeenCalledWith(
        editor,
        expect.objectContaining({ value: expect.objectContaining({ page_id: 'Page 5' }) })
      );
    });

    it('follows a highlighted person into another section when a refresh drops its section', async () => {
      const ada = personItem('ada', 'Ada');
      const bob = personItem('bob', 'Bob');
      const respondAfter = (delayMs: number, response: MentionSearchResponse) =>
        new Promise<MentionSearchResponse>((resolve) => {
          setTimeout(() => resolve(response), delayMs);
        });

      mockPanelContext.searchText = '';
      mockEditorContext.searchMentions = jest
        .fn()
        .mockImplementationOnce(() =>
          respondAfter(50, {
            sections: [
              section(MentionSearchSectionKind.Suggested, [ada]),
              section(MentionSearchSectionKind.People, [ada, bob]),
            ],
          })
        )
        .mockImplementationOnce(() =>
          respondAfter(400, { sections: [section(MentionSearchSectionKind.People, [bob, ada])] })
        );
      renderPanel();
      await advance(60);
      cleanup();
      // Past the freshness window, so reopening refreshes the cached answer.
      await advance(MENTION_SEARCH_CACHE_FRESH_MS);

      // Reopening shows the cached bare-@ answer at once and refreshes it in the background.
      const { editor } = renderPanel();

      await placeCaretAtEnd(editor);
      await pressKey('ArrowDown');
      expect(isSelectedIn(MentionSearchSectionKind.Suggested, 'Ada')).toBe(true);

      await advance(400);
      expect(document.querySelector(`[data-section-kind="${MentionSearchSectionKind.Suggested}"]`)).toBeNull();
      expect(isSelectedIn(MentionSearchSectionKind.People, 'Ada')).toBe(true);
      expect(isSelectedIn(MentionSearchSectionKind.People, 'Bob')).toBe(false);

      await pressKey('Enter');
      expect(mockAddMark).toHaveBeenCalledWith(
        editor,
        expect.objectContaining({ value: expect.objectContaining({ type: MentionType.Person, person_id: 'ada' }) })
      );
    });
  });

  describe('request lifecycle', () => {
    const typedPlan = (delayMs: number): SearchPlan => ({ primary: [complete(delayMs)], rows: [complete(delayMs)] });
    const recentPage: MentionSearchResponse = {
      sections: [section(MentionSearchSectionKind.Pages, [pageItem('Recent page')])],
    };

    function closePanel(rerender: () => void) {
      mockPanelContext.isPanelOpen = () => false;
      rerender();
    }

    // Answers the empty query with `recentPage` after `bareMs`, and typed queries after 80 ms.
    function createBareSearch(bareMs: number) {
      return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
        const query = request.query ?? '';

        return answerAfter(query ? 80 : bareMs, options?.signal, () =>
          query ? respond(laneOf(request), query, 'complete') : recentPage
        );
      });
    }

    it('sends the typed primary and rows requests on two streams of one session, with increasing times', async () => {
      // Two keystrokes in the same millisecond still get strictly increasing times on each stream.
      jest.spyOn(Date, 'now').mockReturnValue(1_000);
      const search = createSearch({ road: typedPlan(400), roadmap: typedPlan(80) });

      mockEditorContext.searchMentions = search;
      const { rerender } = renderPanel();

      await advance(120);
      mockPanelContext.searchText = 'roadmap';
      rerender();
      await advance(120);

      const [primary, rows, nextPrimary, nextRows] = search.mock.calls.map(([request, options]) => ({
        lane: laneOf(request),
        streamId: options?.streamId ?? '',
        requestTime: options?.requestTime ?? 0,
      }));
      const session = primary.streamId.match(/^web-mention-(.+)-primary$/)?.[1];

      expect([primary, rows, nextPrimary, nextRows].map(({ lane }) => lane)).toEqual([
        'primary',
        'rows',
        'primary',
        'rows',
      ]);
      expect(session).toBeTruthy();
      expect(rows.streamId).toBe(`web-mention-${session}-rows`);
      expect([nextPrimary.streamId, nextRows.streamId]).toEqual([primary.streamId, rows.streamId]);
      expect([primary.requestTime, nextPrimary.requestTime]).toEqual([1_000, 1_001]);
      expect([rows.requestTime, nextRows.requestTime]).toEqual([1_000, 1_001]);
    });

    it('opens every panel session on new streams', async () => {
      const search = createSearch({
        road: { primary: [complete(80), complete(80)], rows: [complete(80), complete(80)] },
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(200);
      cleanup();
      clearMentionSearchCacheForTests();
      renderPanel();
      await advance(200);

      const streams = search.mock.calls.map(([, options]) => options?.streamId);

      expect(streams[0]).not.toBe(streams[2]);
      expect(streams[1]).not.toBe(streams[3]);
    });

    it('opens a new session when the mounted panel closes and opens again', async () => {
      const search = createSearch({
        road: { primary: [complete(80), complete(80)], rows: [complete(80), complete(80)] },
      });

      mockEditorContext.searchMentions = search;
      const { rerender } = renderPanel();

      await advance(200);
      closePanel(rerender);
      // Without a cached answer, the reopened panel sends on the same lanes as the first opening.
      clearMentionSearchCacheForTests();
      mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
      rerender();
      await advance(200);

      const streams = search.mock.calls.map(([, options]) => options?.streamId ?? '');

      expect(streams).toHaveLength(4);
      expect(streams[2]).toMatch(/^web-mention-.+-primary$/);
      expect(streams[3]).toMatch(/^web-mention-.+-rows$/);
      expect(streams[2]).not.toBe(streams[0]);
      expect(streams[3]).not.toBe(streams[1]);
    });

    it('aborts the typed requests of the previous query without logging them or caching them', async () => {
      const search = createSearch({ road: typedPlan(400), roadmap: typedPlan(80) });

      mockEditorContext.searchMentions = search;
      const { rerender } = renderPanel();

      await advance(200);
      expect(sentOptions(search, 'road').map((options) => options?.signal?.aborted)).toEqual([false, false]);

      mockPanelContext.searchText = 'roadmap';
      rerender();
      expect(sentOptions(search, 'road').map((options) => options?.signal?.aborted)).toEqual([true, true]);

      await advance(1_000);
      expect(shows('Page for roadmap')).toBe(true);
      expect(shows('complete row for roadmap')).toBe(true);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeUndefined();
      expect(getCachedMentionSections(sentCacheKey(search, 'roadmap'))).toBeDefined();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('never caches the answer to aborted typed requests that arrives after a newer query', async () => {
      // The server answers the older pair anyway, after the newer one: its primary superseded,
      // its rows complete, which the rows-only rule alone would cache.
      const search = jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
        const query = request.query ?? '';
        const lane = laneOf(request);

        if (query === 'road') {
          return new Promise<MentionSearchResponse>((resolve) => {
            setTimeout(() => resolve(lane === 'primary' ? { sections: [], partial: true } : { sections: [] }), 400);
          });
        }

        return answerAfter(80, options?.signal, () => respond(lane, query, 'complete'));
      });

      mockEditorContext.searchMentions = search;
      const { rerender } = renderPanel();

      await advance(200);
      mockPanelContext.searchText = 'roadmap';
      rerender();
      await advance(200);
      expect(shows('Page for roadmap')).toBe(true);

      // The older answer arrives at 520 ms.
      await advance(400);
      expect(sentOptions(search, 'road').map((options) => options?.signal?.aborted)).toEqual([true, true]);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeUndefined();
      expect(getCachedMentionSections(sentCacheKey(search, 'roadmap'))).toEqual(
        mergeMentionSearchResponses([respond('primary', 'roadmap', 'complete'), respond('rows', 'roadmap', 'complete')])
          .sections
      );
      expect(shows('Page for roadmap')).toBe(true);
    });

    describe('when the rows retry fails', () => {
      const retryLater = {
        error: { code: ERROR_CODE.RETRY_LATER, message: 'retry later', retryAfterSecs: 1 },
      };
      const rowsRetryFailed = { error: new Error('rows retry failed') };

      it('counts down a busy search, sends it again, and settles on its answer instead of loading forever', async () => {
        const search = createAnswerSearch({
          primary: [
            [80, retryLater],
            [80, { sections: [] }],
          ],
          rows: [
            [80, retryLater],
            [80, { sections: [], partial: true }],
            [80, rowsRetryFailed],
          ],
        });

        mockEditorContext.searchMentions = search;
        renderPanel();

        // Busy at 200 ms for the 1 s Retry-After, sent again at 1200 ms; the superseded rows are
        // retried at 1780 ms and fail at 1860 ms.
        await advance(200);
        expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('1');
        expect(isBusy()).toBe(false);
        expect(showsNoResult()).toBe(false);

        await advance(1_000);
        expect(search).toHaveBeenCalledTimes(4);
        expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('0');
        expect(shows('document.mention.retrying')).toBe(true);

        await advance(650);
        expect(search).toHaveBeenCalledTimes(5);
        expect(busyRow()).not.toBeNull();

        await advance(STEP_MS);
        expect(busyRow()).toBeNull();
        expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
        expect(isBusy()).toBe(false);
        expect(showsNoResult()).toBe(false);
        expect(console.error).toHaveBeenCalledWith(rowsRetryFailed.error);
      });

      it('keeps the cached answer on screen when its refresh fails, and Retry refreshes it', async () => {
        Element.prototype.scrollIntoView = jest.fn();
        const freshPage: MentionSearchResponse = {
          sections: [section(MentionSearchSectionKind.Pages, [pageItem('Fresh road')])],
        };
        const search = createAnswerSearch({
          primary: [
            [80, respond('primary', 'road', 'complete')],
            [80, freshPage],
            [80, freshPage],
          ],
          rows: [
            [80, respond('rows', 'road', 'complete')],
            [80, respond('rows', 'road', 'failed')],
            [80, rowsRetryFailed],
            [80, respond('rows', 'road', 'complete')],
          ],
        });

        mockEditorContext.searchMentions = search;
        renderPanel();
        await advance(200);
        cleanup();
        await advance(MENTION_SEARCH_CACHE_FRESH_MS);

        const roadKey = sentCacheKey(search, 'road');
        const cachedRoad = getCachedMentionSections(roadKey);

        expect(cachedRoad).toBeDefined();

        // Reopening paints the cached answer and refreshes it: the rows fail, and so does their
        // retry 500 ms later.
        const { editor } = renderPanel();

        expect(shows('complete row for road')).toBe(true);
        await advance(650);
        expect(search).toHaveBeenCalledTimes(5);
        expect(retryRow()).toBeNull();

        await advance(STEP_MS);
        expect(shows('Page for road')).toBe(true);
        expect(shows('complete row for road')).toBe(true);
        expect(shows('Fresh road')).toBe(false);
        expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
        expect(getCachedMentionSections(roadKey)).toEqual(cachedRoad);

        // ArrowUp from no highlight wraps to the last option, the Retry row.
        await placeCaretAtEnd(editor);
        await pressKey('ArrowUp');
        expect(retryRow()?.getAttribute('data-selected')).toBe('true');
        await pressKey('Enter');
        expect(shows('document.mention.retrying')).toBe(true);
        await advance(80);

        expect(search).toHaveBeenCalledTimes(7);
        expect(shows('Fresh road')).toBe(true);
        expect(shows('complete row for road')).toBe(true);
        expect(retryRow()).toBeNull();
        // The user chose Retry, not one of the results it brought, so nothing is highlighted.
        expect(highlightedCount()).toBe(0);
        expect(getCachedMentionSections(roadKey)).toEqual(
          mergeMentionSearchResponses([freshPage, respond('rows', 'road', 'complete')]).sections
        );
      });
    });

    it.each(['closes', 'unmounts'])(
      'aborts the typed requests when the panel %s, and caches none of them',
      async (how) => {
        const search = createSearch({ road: typedPlan(400) });

        mockEditorContext.searchMentions = search;
        const { rerender } = renderPanel();

        await advance(200);
        if (how === 'closes') closePanel(rerender);
        else cleanup();

        expect(sentOptions(search, 'road').map((options) => options?.signal?.aborted)).toEqual([true, true]);
        await advance(1_000);
        expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeUndefined();
        expect(console.error).not.toHaveBeenCalled();
      }
    );

    it.each(['the query changes', 'the panel closes'])(
      'lets a bare request finish when %s and caches its answer under the bare key',
      async (change) => {
        mockPanelContext.searchText = '';
        const search = createBareSearch(300);

        mockEditorContext.searchMentions = search;
        const { rerender } = renderPanel();

        await advance(100);
        const [bareRequest, bareOptions] = search.mock.calls[0];

        expect(bareRequest.include).not.toContain(MentionTargetKind.DatabaseRow);
        expect(bareOptions?.streamId).toMatch(/^web-mention-.+-bare$/);

        if (change === 'the panel closes') {
          closePanel(rerender);
        } else {
          mockPanelContext.searchText = 'r';
          rerender();
        }

        expect(bareOptions?.signal?.aborted).toBe(false);
        await advance(300);
        expect(getCachedMentionSections(sentCacheKey(search, ''))).toEqual(recentPage.sections);
        expect(console.error).not.toHaveBeenCalled();
      }
    );

    it('never caches a refresh answer that a newer request on its lane replaced', async () => {
      const goodRoad = [complete(80)];
      const search = createSearch({
        road: { primary: [...goodRoad], rows: [...goodRoad] },
        roadmap: typedPlan(80),
      });

      // Cache both queries with complete answers.
      mockEditorContext.searchMentions = search;
      const { rerender } = renderPanel();

      await advance(200);
      mockPanelContext.searchText = 'roadmap';
      rerender();
      await advance(200);
      cleanup();
      // Past the freshness window, so both cached answers are refreshed when shown again.
      await advance(MENTION_SEARCH_CACHE_FRESH_MS);

      const roadKey = sentCacheKey(search, 'road');
      const roadmapKey = sentCacheKey(search, 'roadmap');
      const cachedRoad = getCachedMentionSections(roadKey);

      expect(cachedRoad).toEqual(
        mergeMentionSearchResponses([respond('primary', 'road', 'complete'), respond('rows', 'road', 'complete')])
          .sections
      );

      // Reopen on 'road': its refresh answers late and empty, and ignores the abort.
      const fresh = (query: string) => ({
        sections: [section(MentionSearchSectionKind.Pages, [pageItem(`Fresh ${query}`)])],
      });
      const refreshSearch = jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
        const query = request.query ?? '';

        if (query === 'road') {
          return new Promise<MentionSearchResponse>((resolve) => {
            setTimeout(() => resolve({ sections: [] }), 400);
          });
        }

        return answerAfter(80, options?.signal, () => (laneOf(request) === 'primary' ? fresh(query) : { sections: [] }));
      });

      mockPanelContext.searchText = 'road';
      mockEditorContext.searchMentions = refreshSearch;
      const reopened = renderPanel();

      expect(shows('Page for road')).toBe(true);
      await advance(100);
      mockPanelContext.searchText = 'roadmap';
      reopened.rerender();

      const roadRefresh = sentOptions(refreshSearch, 'road');

      expect(
        roadRefresh.map((options) => options?.streamId?.replace(/^web-mention-.+?-(refresh(-rows)?)$/, '$1'))
      ).toEqual(['refresh', 'refresh-rows']);
      expect(roadRefresh.map((options) => options?.signal?.aborted)).toEqual([true, true]);

      await advance(500);
      expect(refreshSearch).toHaveBeenCalledTimes(4);
      expect(getCachedMentionSections(roadKey)).toEqual(cachedRoad);
      expect(getCachedMentionSections(roadmapKey)).toEqual(fresh('roadmap').sections);
      expect(shows('Fresh roadmap')).toBe(true);
    });

    describe('against a Search that supersedes by stream', () => {
      // Search registers each request under its stream, or under its query without one. A newer
      // request cancels the one in flight on its key; one that is not newer is cancelled at once.
      function createSupersedingSearch({
        forwardsStream,
        superseded,
      }: {
        forwardsStream: boolean;
        superseded: MentionSearchResponse;
      }) {
        const inflight = new Map<string, { requestTime: number; supersede: () => void }>();

        return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
          const query = request.query ?? '';
          const key = (forwardsStream && options?.streamId) || `q:${query}`;
          const requestTime = options?.requestTime ?? Date.now();

          return new Promise<MentionSearchResponse>((resolve) => {
            const previous = inflight.get(key);

            if (previous && requestTime <= previous.requestTime) {
              resolve(superseded);
              return;
            }

            previous?.supersede();

            const entry = {
              requestTime,
              supersede: () => {
                clearTimeout(timer);
                resolve(superseded);
              },
            };
            const timer = setTimeout(() => {
              if (inflight.get(key) === entry) inflight.delete(key);
              resolve(respond(laneOf(request), query, 'complete'));
            }, 80);

            inflight.set(key, entry);
          });
        });
      }

      it('renders the page and the row, and a reopened panel paints both from the cache', async () => {
        const search = createSupersedingSearch({ forwardsStream: true, superseded: { sections: [], partial: true } });

        mockEditorContext.searchMentions = search;
        renderPanel();
        await advance(200);

        expect(shows('Page for road')).toBe(true);
        expect(shows('complete row for road')).toBe(true);
        cleanup();

        renderPanel();
        expect(shows('Page for road')).toBe(true);
        expect(shows('complete row for road')).toBe(true);
      });

      it('loses one of the two requests when the stream does not reach Search, as before', async () => {
        const search = createSupersedingSearch({ forwardsStream: false, superseded: { sections: [] } });

        mockEditorContext.searchMentions = search;
        renderPanel();
        await advance(200);

        expect(shows('Page for road')).toBe(true);
        expect(shows('complete row for road')).toBe(false);
      });
    });

    it.each([
      { name: 'a typed request', searchText: 'road', sentAtMs: 120, deadlineMs: MENTION_TYPED_DEADLINE_MS },
      { name: 'a bare request', searchText: '', sentAtMs: 0, deadlineMs: MENTION_BARE_DEADLINE_MS },
    ])(
      'aborts $name that outlives its deadline and shows the unavailable row, never "No result"',
      async ({ searchText, sentAtMs, deadlineMs }) => {
        mockPanelContext.searchText = searchText;
        const search = jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) =>
          answerAfter(60_000, options?.signal, () => respond(laneOf(request), searchText, 'complete'))
        );

        mockEditorContext.searchMentions = search;
        renderPanel();

        await advance(sentAtMs + deadlineMs - 1);
        expect(search.mock.calls.map(([, options]) => options?.signal?.aborted)).toEqual(
          searchText ? [false, false] : [false]
        );
        expect(isBusy()).toBe(true);
        expect(retryRow()).toBeNull();

        await advance(1);
        expect(search.mock.calls.map(([, options]) => options?.signal?.aborted)).toEqual(
          searchText ? [true, true] : [true]
        );
        expect(isBusy()).toBe(false);
        expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
        expect(showsNoResult()).toBe(false);
        expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ transportFailure: 'timeout' }));
      }
    );

    // The rows retry cannot complete an answer whose primary request failed, so it is skipped and
    // the unavailable row shows when the primary fails, not one retry later.
    it.each([
      {
        name: 'stalls until its deadline',
        primary: [60_000, respond('primary', 'road', 'complete')] as [number, Answer],
        unavailableAtMs: 120 + MENTION_TYPED_DEADLINE_MS,
      },
      {
        name: 'fails with a 500',
        primary: [80, { error: { code: 500, message: 'Internal Server Error', httpStatus: 500 } }] as [number, Answer],
        unavailableAtMs: 200,
      },
    ])(
      'shows the unavailable row as soon as the primary request $name, without retrying failed rows',
      async ({ primary, unavailableAtMs }) => {
        const search = createAnswerSearch({
          primary: [primary],
          rows: [
            [80, respond('rows', 'road', 'failed')],
            [80, respond('rows', 'road', 'complete')],
          ],
        });

        mockEditorContext.searchMentions = search;
        renderPanel();

        await advance(unavailableAtMs - 1);
        expect(retryRow()).toBeNull();
        expect(isBusy()).toBe(true);

        await advance(1);
        expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
        expect(isBusy()).toBe(false);
        expect(showsNoResult()).toBe(false);

        await advance(5_000);
        expect(search).toHaveBeenCalledTimes(2);
        expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
      }
    );
  });

  describe('failure and cache states', () => {
    const recentPage: MentionSearchResponse = {
      sections: [section(MentionSearchSectionKind.Pages, [pageItem('Recent page')])],
    };
    const serverError = (code: number, message: string) => ({
      error: { code, message, sourceDomain: 'http', httpStatus: code },
    });

    beforeEach(() => {
      Element.prototype.scrollIntoView = jest.fn();
    });

    // Answers the empty query with `recentPage` after `bareMs`, and typed queries after 80 ms.
    function createBareSearch(bareMs: number) {
      return jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
        const query = request.query ?? '';

        return answerAfter(query ? 80 : bareMs, options?.signal, () =>
          query ? respond(laneOf(request), query, 'complete') : recentPage
        );
      });
    }

    it('shows the unavailable row instead of "No result" after a 500, and Retry from the keyboard sends it again', async () => {
      const search = createAnswerSearch({
        primary: [
          [80, serverError(500, 'Internal Server Error')],
          [80, respond('primary', 'road', 'complete')],
        ],
        rows: [
          [80, serverError(500, 'Internal Server Error')],
          [80, respond('rows', 'road', 'complete')],
        ],
      });

      mockEditorContext.searchMentions = search;
      const { editor } = renderPanel();

      await advance(200);
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
      expect(shows('document.mention.suggestionsUnavailable')).toBe(true);
      expect(shows('document.mention.retry')).toBe(true);
      expect(showsNoResult()).toBe(false);
      expect(isBusy()).toBe(false);

      await placeCaretAtEnd(editor);
      await pressKey('ArrowDown');
      expect(retryRow()?.getAttribute('data-selected')).toBe('true');

      // Sent again without the typing debounce. The row says so and keeps the highlight, and a
      // second Enter while it is pending sends nothing.
      await pressKey('Enter');
      await advance(1);
      expect(search).toHaveBeenCalledTimes(4);
      expect(shows('document.mention.retrying')).toBe(true);
      expect(retryRow()?.getAttribute('data-selected')).toBe('true');
      await pressKey('Enter');
      await advance(1);
      expect(search).toHaveBeenCalledTimes(4);

      await advance(80);
      expect(shows('Page for road')).toBe(true);
      expect(shows('complete row for road')).toBe(true);
      expect(retryRow()).toBeNull();
      expect(highlightedCount()).toBe(0);
      expect(showsNoResult()).toBe(false);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeDefined();
    });

    it('renders the rows and the unavailable row when the primary request fails with a 503, and a click retries', async () => {
      const search = createAnswerSearch({
        primary: [
          [80, serverError(503, 'Service Unavailable')],
          [80, respond('primary', 'road', 'complete')],
        ],
        rows: [
          [80, respond('rows', 'road', 'complete')],
          [80, respond('rows', 'road', 'complete')],
        ],
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(200);

      expect(shows('complete row for road')).toBe(true);
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
      expect(showsNoResult()).toBe(false);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeUndefined();

      // The rows stay on screen while the retry is pending.
      await act(async () => {
        fireEvent.click(retryRow() as HTMLElement);
      });
      await advance(1);
      expect(search).toHaveBeenCalledTimes(4);
      expect(shows('complete row for road')).toBe(true);

      await advance(80);
      expect(shows('Page for road')).toBe(true);
      expect(retryRow()).toBeNull();
    });

    it('keeps the sections that answered and offers Retry when the server fails a section', async () => {
      const search = createAnswerSearch({
        primary: [
          [
            80,
            {
              sections: [
                section(MentionSearchSectionKind.People, [personItem('ada', 'Ada')]),
                failedSection(MentionSearchSectionKind.Pages),
              ],
              partial: true,
            },
          ],
        ],
        rows: [[80, respond('rows', 'road', 'complete')]],
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(2_000);

      expect(shows('Ada')).toBe(true);
      expect(shows('complete row for road')).toBe(true);
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
      // Only the rows request is retried automatically.
      expect(search).toHaveBeenCalledTimes(2);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeUndefined();
    });

    it('shows a busy countdown when the server asks to retry later, and sends the search again when it ends', async () => {
      const retryLater = { error: { code: ERROR_CODE.RETRY_LATER, message: 'retry later' } };
      const search = createAnswerSearch({
        primary: [
          [80, retryLater],
          [80, respond('primary', 'road', 'complete')],
        ],
        rows: [
          [80, respond('rows', 'road', 'complete')],
          [80, respond('rows', 'road', 'complete')],
        ],
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(200);

      // Mention RetryLater carries no Retry-After, so the countdown starts at the 3 s default.
      expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('3');
      expect(shows('complete row for road')).toBe(true);
      expect(retryRow()).toBeNull();
      expect(isBusy()).toBe(false);
      expect(showsNoResult()).toBe(false);

      await advance(1_000);
      expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('2');
      await advance(1_000);
      expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('1');
      expect(search).toHaveBeenCalledTimes(2);

      await advance(1_000);
      expect(search).toHaveBeenCalledTimes(4);
      expect(shows('document.mention.retrying')).toBe(true);

      await advance(80);
      expect(busyRow()).toBeNull();
      expect(shows('Page for road')).toBe(true);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeDefined();
    });

    it('shows offline when the requests fail while the browser is offline, and searches again once back online', async () => {
      const onLine = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      const networkError = {
        error: { code: -1, message: 'Network Error', sourceDomain: 'transport', transportFailure: 'network' },
      };
      const search = createAnswerSearch({
        primary: [
          [10, networkError],
          [80, respond('primary', 'road', 'complete')],
        ],
        rows: [
          [10, networkError],
          [80, respond('rows', 'road', 'complete')],
        ],
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(130);

      expect(retryRow()?.getAttribute('data-status')).toBe('offline');
      expect(shows('document.mention.offline')).toBe(true);
      expect(showsNoResult()).toBe(false);

      onLine.mockReturnValue(true);
      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });
      await advance(1);
      expect(search).toHaveBeenCalledTimes(4);

      await advance(80);
      expect(shows('Page for road')).toBe(true);
      expect(retryRow()).toBeNull();
    });

    it('paints a cached answer without a request for 10 s, then revalidates it once', async () => {
      const search = createSearch({
        road: { primary: [complete(80), complete(80)], rows: [complete(80), complete(80)] },
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(200);
      cleanup();

      // Reopened 5 s after the answer: painted from the cache, with no request.
      await advance(5_000);
      renderPanel();
      expect(shows('Page for road')).toBe(true);
      expect(shows('complete row for road')).toBe(true);
      await advance(1_000);
      expect(search).toHaveBeenCalledTimes(2);
      cleanup();

      // Reopened 10 s after it: painted at once, then refreshed once.
      await advance(MENTION_SEARCH_CACHE_FRESH_MS - 6_000);
      renderPanel();
      expect(shows('Page for road')).toBe(true);
      expect(search).toHaveBeenCalledTimes(4);
      await advance(1_000);
      expect(search).toHaveBeenCalledTimes(4);
      expect(shows('complete row for road')).toBe(true);
    });

    it('paints the cached answer after FOLDER_VIEW_CHANGED on the editor emitter, then refreshes it once', async () => {
      const eventEmitter = new EventEmitter();
      const search = createBareSearch(50);

      mockPanelContext.searchText = '';
      mockEditorContext.eventEmitter = eventEmitter;
      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(50);
      cleanup();

      // Well inside the freshness window, but the outline changed since.
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, { viewId: 'another-page' });
      renderPanel();

      expect(shows('Recent page')).toBe(true);
      expect(search).toHaveBeenCalledTimes(2);
      await advance(1_000);
      expect(search).toHaveBeenCalledTimes(2);
      expect(shows('Recent page')).toBe(true);
    });

    it('drops the cached answers of a workspace when a panel opens on another one', async () => {
      const search = createSearch({
        road: { primary: [complete(80), complete(80)], rows: [complete(80), complete(80)] },
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(200);
      cleanup();

      const roadKey = sentCacheKey(search, 'road');

      expect(getCachedMentionSections(roadKey)).toBeDefined();

      mockEditorContext.workspaceId = 'another-workspace';
      try {
        renderPanel();
        expect(getCachedMentionSections(roadKey)).toBeUndefined();
        await advance(200);
        expect(search).toHaveBeenCalledTimes(4);
        expect(shows('Page for road')).toBe(true);
      } finally {
        mockEditorContext.workspaceId = 'workspace';
      }
    });

    it('caches a bare answer that arrives after typing, and the next @ paints it without a request', async () => {
      const search = createBareSearch(300);

      mockPanelContext.searchText = '';
      mockEditorContext.searchMentions = search;
      const { rerender } = renderPanel();

      await advance(100);
      mockPanelContext.searchText = 'r';
      rerender();
      await advance(300);
      cleanup();

      mockPanelContext.searchText = '';
      renderPanel();
      expect(shows('Recent page')).toBe(true);
      await advance(1_000);
      expect(search.mock.calls.filter(([request]) => !request.query)).toHaveLength(1);
    });

    it('treats an answer without section status, from an older server, as complete', async () => {
      const legacy = (response: MentionSearchResponse): MentionSearchResponse => ({
        ...response,
        sections: response.sections.map(
          ({ kind, title, items, has_more }) => ({ kind, title, items, has_more } as MentionSearchSection)
        ),
      });
      const search = createAnswerSearch({
        primary: [[80, legacy(respond('primary', 'road', 'complete'))]],
        rows: [[80, legacy(respond('rows', 'road', 'partial'))]],
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(2_000);

      expect(shows('Page for road')).toBe(true);
      expect(shows('partial row for road')).toBe(true);
      expect(retryRow()).toBeNull();
      expect(search).toHaveBeenCalledTimes(2);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeDefined();
    });

    it('still says "No result" when the server answered completely and nothing matched', async () => {
      mockEditorContext.searchMentions = createAnswerSearch({
        primary: [[80, { sections: [] }]],
        rows: [[80, { sections: [] }]],
      });
      renderPanel();
      await advance(200);

      expect(showsNoResult()).toBe(true);
      expect(retryRow()).toBeNull();
      expect(busyRow()).toBeNull();
    });

    it.each([
      {
        name: 'its primary answers nothing before its rows request fails',
        retryRows: [[400, serverError(500, 'Internal Server Error')]] as Array<[number, Answer]>,
      },
      {
        name: 'its rows fail twice behind a primary that answers nothing',
        retryRows: [
          [80, respond('rows', 'road', 'failed')],
          [80, respond('rows', 'road', 'failed')],
        ] as Array<[number, Answer]>,
      },
    ])('keeps the rows of the previous attempt on screen when a retry finds nothing: $name', async ({ retryRows }) => {
      const search = createAnswerSearch({
        primary: [
          [80, serverError(503, 'Service Unavailable')],
          [80, { sections: [] }],
        ],
        rows: [[80, respond('rows', 'road', 'complete')], ...retryRows],
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(200);
      expect(shows('complete row for road')).toBe(true);

      await act(async () => {
        fireEvent.click(retryRow() as HTMLElement);
      });

      for (let now = 0; now < 1_500; now += STEP_MS) {
        await advance(STEP_MS);
        expect(shows('complete row for road')).toBe(true);
      }

      expect(search).toHaveBeenCalledTimes(3 + retryRows.length);
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
      expect(shows('document.mention.retrying')).toBe(false);
    });

    it('shows People without the unavailable row when only their annotation degraded, but never caches them', async () => {
      // Cloud sets `partial` when the People annotation degrades, and Search leaves out an empty
      // Pages section, so a typed name that matches no object looks like a superseded answer.
      const search = createAnswerSearch({
        primary: [
          [80, { sections: [section(MentionSearchSectionKind.People, [personItem('ada', 'Ada')])], partial: true }],
        ],
        rows: [[80, { sections: [] }]],
      });

      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(2_000);

      expect(shows('Ada')).toBe(true);
      expect(retryRow()).toBeNull();
      expect(showsNoResult()).toBe(false);
      expect(search).toHaveBeenCalledTimes(2);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeUndefined();
    });

    it('never lets a late bare answer from an earlier opening replace a newer cached one', async () => {
      const bareAnswers = [
        { delayMs: 3_000, title: 'Old page' },
        { delayMs: 100, title: 'New page' },
      ];
      const search = jest.fn((request: MentionSearchRequest, options?: MentionSearchOptions) => {
        const next = bareAnswers.shift();

        if (request.query || !next) return Promise.reject(new Error('unplanned search'));
        return answerAfter(next.delayMs, options?.signal, () => ({
          sections: [section(MentionSearchSectionKind.Pages, [pageItem(next.title)])],
        }));
      });

      mockPanelContext.searchText = '';
      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(200);
      cleanup();

      // Reopened while the first bare request runs on: a newer one answers first and is cached.
      renderPanel();
      await advance(100);
      expect(shows('New page')).toBe(true);
      cleanup();

      // The first answer arrives at 3000 ms; the panel reopens at 3200 ms, inside the freshness window.
      await advance(2_900);
      renderPanel();
      expect(shows('New page')).toBe(true);
      expect(shows('Old page')).toBe(false);
      await advance(1_000);
      expect(search).toHaveBeenCalledTimes(2);
    });

    it('drops a view the user loses access to from the open panel and from answers sent before', async () => {
      const eventEmitter = new EventEmitter();
      const pages = [pageItem('Secret page'), pageItem('Kept page')];
      const search = createAnswerSearch({
        primary: [[80, { sections: [section(MentionSearchSectionKind.Pages, pages)] }]],
        // Sent before the revoke, answered after it. Its row belongs to the database view `grid`.
        rows: [[400, { sections: [section(MentionSearchSectionKind.Pages, [rowItem('Grid row')])] }]],
      });

      mockEditorContext.eventEmitter = eventEmitter;
      mockEditorContext.searchMentions = search;
      renderPanel();
      await advance(200);
      expect(shows('Secret page')).toBe(true);

      await act(async () => {
        eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'Secret page' });
        eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'grid' });
      });
      expect(shows('Secret page')).toBe(false);
      expect(shows('Kept page')).toBe(true);

      await advance(320);
      expect(search).toHaveBeenCalledTimes(2);
      expect(shows('Grid row')).toBe(false);
      expect(shows('Kept page')).toBe(true);
      expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toEqual([
        section(MentionSearchSectionKind.Pages, [pageItem('Kept page')]),
      ]);
    });

    describe('cooldowns and the refresh of a cached answer', () => {
      // Mention RetryLater carries no Retry-After, so each cooldown lasts the 3 s default.
      const retryLater: Answer = { error: { code: ERROR_CODE.RETRY_LATER, message: 'retry later' } };
      const freshPage: MentionSearchResponse = {
        sections: [section(MentionSearchSectionKind.Pages, [pageItem('Fresh road')])],
      };
      const roadRows = respond('rows', 'road', 'complete');
      const roadmAnswers: Record<Lane, Array<[number, Answer]>> = {
        primary: [[80, respond('primary', 'roadm', 'complete')]],
        rows: [[80, respond('rows', 'roadm', 'complete')]],
      };

      // Caches the answer for 'road' and lets it turn stale, so the next opening refreshes it.
      async function cacheStaleRoad(search: SearchMock) {
        mockEditorContext.searchMentions = search;
        renderPanel();
        await advance(200);
        cleanup();
        await advance(MENTION_SEARCH_CACHE_FRESH_MS);
      }

      it('shows the busy row under a cached answer whose refresh is asked to wait, then refreshes it once', async () => {
        const search = createAnswerSearch({
          primary: [
            [80, respond('primary', 'road', 'complete')],
            [80, retryLater],
            [80, freshPage],
          ],
          rows: [
            [80, roadRows],
            [80, roadRows],
            [80, roadRows],
          ],
        });

        await cacheStaleRoad(search);
        // Painted from the cache and refreshed at once. The refresh is asked to wait.
        renderPanel();
        await advance(80);
        expect(search).toHaveBeenCalledTimes(4);
        expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('3');
        expect(shows('Page for road')).toBe(true);
        expect(shows('complete row for road')).toBe(true);
        expect(retryRow()).toBeNull();
        expect(isBusy()).toBe(false);

        // Refreshed once when the cooldown ends, while the cached answer stays on screen.
        await advance(2_999);
        expect(search).toHaveBeenCalledTimes(4);
        await advance(1);
        expect(search).toHaveBeenCalledTimes(6);
        expect(shows('Page for road')).toBe(true);

        await advance(80);
        expect(shows('Fresh road')).toBe(true);
        expect(shows('Page for road')).toBe(false);
        expect(busyRow()).toBeNull();
        expect(retryRow()).toBeNull();
        await advance(5_000);
        expect(search).toHaveBeenCalledTimes(6);
      });

      it('shows the rest of a cooldown under a cached answer the user comes back to, and refreshes it after', async () => {
        const search = createAnswerSearchByQuery({
          road: {
            primary: [
              [80, respond('primary', 'road', 'complete')],
              [80, retryLater],
              [80, freshPage],
            ],
            rows: [
              [80, roadRows],
              [80, roadRows],
              [80, roadRows],
            ],
          },
          roadm: roadmAnswers,
        });

        await cacheStaleRoad(search);
        const { rerender } = renderPanel();

        await advance(80);
        expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('3');

        // The user types on, and comes back 1 s later, with 2 s of the cooldown left.
        mockPanelContext.searchText = 'roadm';
        rerender();
        await advance(1_000);
        expect(shows('Page for roadm')).toBe(true);
        mockPanelContext.searchText = 'road';
        rerender();

        expect(shows('Page for road')).toBe(true);
        expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('2');
        expect(retryRow()).toBeNull();
        await advance(1_999);
        expect(search).toHaveBeenCalledTimes(6);

        await advance(1);
        expect(search).toHaveBeenCalledTimes(8);
        await advance(80);
        expect(shows('Fresh road')).toBe(true);
        expect(busyRow()).toBeNull();
      });

      it('shows the rest of a cooldown when the user comes back to a query asked to wait, and searches after', async () => {
        const search = createAnswerSearchByQuery({
          road: {
            primary: [
              [80, retryLater],
              [80, respond('primary', 'road', 'complete')],
            ],
            rows: [
              [80, roadRows],
              [80, roadRows],
            ],
          },
          roadm: roadmAnswers,
        });

        mockEditorContext.searchMentions = search;
        const { rerender } = renderPanel();

        // Asked to wait at 200 ms, until 3200 ms.
        await advance(200);
        expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('3');
        mockPanelContext.searchText = 'roadm';
        rerender();
        await advance(1_000);
        expect(shows('Page for roadm')).toBe(true);

        // Back at 1200 ms: nothing is sent before the cooldown ends, and neither the skeleton nor
        // "No result" shows meanwhile.
        mockPanelContext.searchText = 'road';
        rerender();
        expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('2');
        expect(isBusy()).toBe(false);
        expect(showsNoResult()).toBe(false);
        await advance(1_999);
        expect(search).toHaveBeenCalledTimes(4);

        await advance(1);
        expect(search).toHaveBeenCalledTimes(6);
        await advance(80);
        expect(shows('Page for road')).toBe(true);
        expect(busyRow()).toBeNull();
        expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toBeDefined();
      });

      describe('when a reopened panel joins the refresh an earlier opening sent', () => {
        // Caches 'road' and lets it turn stale. A panel opens, which refreshes it at once, and
        // closes 100 ms later. The next opening joins that refresh, which answers 400 ms after it
        // was sent, and sends nothing of its own.
        async function reopenDuringRefresh(search: SearchMock) {
          await cacheStaleRoad(search);
          renderPanel();
          await advance(100);
          cleanup();
          renderPanel();
          expect(shows('Page for road')).toBe(true);
          await advance(300);
          expect(search).toHaveBeenCalledTimes(4);
        }

        it('shows its answer', async () => {
          const search = createAnswerSearch({
            primary: [
              [80, respond('primary', 'road', 'complete')],
              [400, freshPage],
            ],
            rows: [
              [80, roadRows],
              [400, roadRows],
            ],
          });

          await reopenDuringRefresh(search);
          expect(shows('Fresh road')).toBe(true);
          expect(shows('Page for road')).toBe(false);
          expect(retryRow()).toBeNull();
          expect(getCachedMentionSections(sentCacheKey(search, 'road'))).toEqual(
            mergeMentionSearchResponses([freshPage, roadRows]).sections
          );
        });

        it('offers Retry under the cached answer when it fails, and Retry refreshes it', async () => {
          const search = createAnswerSearch({
            primary: [
              [80, respond('primary', 'road', 'complete')],
              [400, serverError(500, 'Internal Server Error')],
              [80, freshPage],
            ],
            rows: [
              [80, roadRows],
              [400, roadRows],
              [80, roadRows],
            ],
          });

          await reopenDuringRefresh(search);
          expect(shows('Page for road')).toBe(true);
          expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
          expect(showsNoResult()).toBe(false);

          await act(async () => {
            fireEvent.click(retryRow() as HTMLElement);
          });
          await advance(80);
          expect(search).toHaveBeenCalledTimes(6);
          expect(shows('Fresh road')).toBe(true);
          expect(retryRow()).toBeNull();
        });

        it('counts down under the cached answer when it is asked to wait, then refreshes it', async () => {
          const search = createAnswerSearch({
            primary: [
              [80, respond('primary', 'road', 'complete')],
              [400, retryLater],
              [80, freshPage],
            ],
            rows: [
              [80, roadRows],
              [400, roadRows],
              [80, roadRows],
            ],
          });

          await reopenDuringRefresh(search);
          expect(shows('Page for road')).toBe(true);
          expect(busyRow()?.getAttribute('data-retry-in-seconds')).toBe('3');
          expect(retryRow()).toBeNull();

          await advance(2_999);
          expect(search).toHaveBeenCalledTimes(4);
          await advance(1);
          expect(search).toHaveBeenCalledTimes(6);
          await advance(80);
          expect(shows('Fresh road')).toBe(true);
          expect(busyRow()).toBeNull();
        });
      });
    });
  });
});
