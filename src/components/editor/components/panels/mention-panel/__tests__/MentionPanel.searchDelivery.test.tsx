import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import {
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
import { clearMentionSearchCacheForTests, getCachedMentionSections } from '../mentionSearchCache';
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
type Outcome = 'complete' | 'partial' | 'reject';

interface Step {
  delayMs: number;
  outcome: Outcome;
}

type SearchPlan = Record<Lane, Step[]>;

const STEP_MS = 10;
const complete = (delayMs: number): Step => ({ delayMs, outcome: 'complete' });
const partial = (delayMs: number): Step => ({ delayMs, outcome: 'partial' });
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

function isRowRequest(request: MentionSearchRequest) {
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow;
}

function createSearch(plans: Record<string, SearchPlan>) {
  const queues = new Map(
    Object.entries(plans).map(([query, plan]) => [query, { primary: [...plan.primary], rows: [...plan.rows] }])
  );

  return jest.fn((request: MentionSearchRequest) => {
    const query = request.query ?? '';
    const lane: Lane = isRowRequest(request) ? 'rows' : 'primary';
    const step = queues.get(query)?.[lane].shift();

    if (!step) return Promise.reject(new Error(`unplanned ${lane} search for "${query}"`));

    return new Promise<MentionSearchResponse>((resolve, rejectSearch) => {
      setTimeout(() => {
        if (step.outcome === 'reject') rejectSearch(new Error(`${lane} search failed`));
        else resolve(respond(lane, query, step.outcome));
      }, step.delayMs);
    });
  });
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
      name: 'S3 rows partial, retry complete',
      plan: { primary: [complete(80)], rows: [partial(80), complete(80)] },
      first: 200,
      done: 780,
    },
    {
      name: 'S4 rows reject, retry complete',
      plan: { primary: [complete(80)], rows: [reject(80), complete(80)] },
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

  it.each([
    {
      name: 'its primary response arrives after the query changed',
      oldPlan: { primary: [complete(400)], rows: [complete(400)] },
      changeAtMs: 300,
    },
    {
      name: 'its rows retry finishes after the query changed',
      oldPlan: { primary: [complete(80)], rows: [partial(80), complete(300)] },
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
      finalRows: 'complete',
    },
    {
      name: 'rows stay partial until the retry',
      plan: { primary: [complete(80)], rows: [partial(80), complete(80)] },
      doneAt: 780,
      finalRows: 'complete',
    },
    {
      name: 'the rows retry is still partial',
      plan: { primary: [complete(80)], rows: [partial(80), partial(80)] },
      doneAt: 780,
      finalRows: 'partial',
    },
  ])('caches only the final cacheable sections when $name', async ({ plan, doneAt, finalRows }) => {
    const search = createSearch({ road: plan });

    mockEditorContext.searchMentions = search;
    renderPanel();
    await advance(doneAt - STEP_MS);

    const cacheKey = buildMentionSearchRequestsCacheKey(
      search.mock.calls.slice(0, 2).map(([request]) => request),
      { workspaceId: 'workspace' }
    );

    expect(shows('Page for road')).toBe(true);
    expect(getCachedMentionSections(cacheKey)).toBeUndefined();

    await advance(STEP_MS);

    expect(search).toHaveBeenCalledTimes(plan.primary.length + plan.rows.length);
    expect(shows(`${finalRows} row for road`)).toBe(true);
    expect(getCachedMentionSections(cacheKey)).toEqual(
      finalRows === 'complete'
        ? mergeMentionSearchResponses([respond('primary', 'road', 'complete'), respond('rows', 'road', 'complete')])
            .sections
        : undefined
    );
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
});
