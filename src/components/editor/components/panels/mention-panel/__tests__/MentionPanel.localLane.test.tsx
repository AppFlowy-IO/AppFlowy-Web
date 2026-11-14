import { EventEmitter } from 'events';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import type { MentionPickerSession } from '@/application/services/js-services/http/mention-presentation-metrics';
import {
  MentionablePerson,
  MentionPersonRole,
  MentionSearchOptions,
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
  View,
  ViewLayout,
} from '@/application/types';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import { getConfigValue } from '@/utils/runtime-config';
import { SERVER_INFO_LOADING, updateServerInfo } from '@/utils/server-info';

import { MentionPanel } from '../MentionPanel';
import {
  clearMentionLocalIndex,
  recordMentionAccessChanged,
  recordMentionRoster,
  recordMentionViewCreated,
  recordMentionViewOpened,
  recordMentionViewRenamed,
  setMentionIndexSources,
} from '../mentionLocalIndex';
import { clearMentionSessionPersonPicks, MENTION_BARE_CREATION_LIFT_MS } from '../mentionLocalLane';
import { MENTION_TYPED_DEADLINE_MS } from '../mentionRequestLanes';
import { clearMentionSearchCacheForTests } from '../mentionSearchCache';
import { MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY, MENTION_SCHEDULER_MODE_OVERRIDE_KEY } from '../mentionSearchScheduler';
import { MENTION_LOCAL_LANE_OVERRIDE_KEY, MENTION_TYPEAHEAD_V2_OVERRIDE_KEY } from '../mentionTypeaheadFlag';

const mockAddMark = jest.fn();
const mockReport = jest.fn();
const WORKSPACE = 'workspace';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const ME = uuid(99);
const mockCurrentUser = {
  uid: '7',
  uuid: ME,
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
// A stable `t`, as react-i18next gives one per language.
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
  error?: unknown;
}

const NEVER: Reply = { delayMs: 1e9 };
const EMPTY: MentionSearchResponse = { sections: [] };
const SERVER_URL = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');

function page(id: string, title: string): MentionSearchResultItem {
  return { kind: MentionTargetKind.Page, object_id: id, title, mention: { type: MentionTargetKind.Page, page_id: id } };
}

function roster(n: number, name: string): MentionablePerson {
  return {
    uid: String(100 + n),
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    email: `${name.toLowerCase()}@appflowy.io`,
    name,
    role: MentionPersonRole.Member,
    person_id: uuid(n),
    invited: false,
    last_mentioned_at: null,
  };
}

function personItem(entry: MentionablePerson): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: entry.person_id,
    title: entry.name,
    subtitle: entry.email,
    mention: { type: MentionTargetKind.Person, person_id: entry.person_id, person_name: entry.name, page_id: 'page' },
  };
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

function pages(...items: MentionSearchResultItem[]): MentionSearchResponse {
  return { sections: [section(MentionSearchSectionKind.Pages, items)] };
}

function people(...items: MentionSearchResultItem[]): MentionSearchResponse {
  return { sections: [section(MentionSearchSectionKind.People, items)] };
}

function view(id: string, name: string, fields: Partial<View> = {}): View {
  return {
    view_id: id,
    name,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...fields,
  };
}

/** The awareness of a page, with these people on it, as Web writes its state (`user_uuid`). */
function awarenessOf(present: { name: string; uuid: string }[]) {
  const states = new Map(
    present.map(({ name, uuid: id }, index) => [
      index + 1,
      {
        user: { uid: index + 1, device_id: `${name}-device` },
        metadata: JSON.stringify({ user_name: name, user_uuid: id }),
      },
    ])
  );

  return { getStates: () => states, on: jest.fn(), off: jest.fn() };
}

function laneOf(request: MentionSearchRequest): Lane {
  if (!request.query?.trim()) return 'bare';
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow ? 'rows' : 'primary';
}

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

type PanelView = ReturnType<typeof renderPanel>;

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

/** Closes the picker and opens it again on the bare `@`, as a new `@` does. */
async function reopen(view: PanelView, waitMs = 0) {
  mockPanelContext.isPanelOpen = () => false;
  view.rerender();
  mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
  mockPanelContext.searchText = '';
  view.rerender();
  await advance(waitMs);
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function resultOptions() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-option-kind]'));
}

function titles() {
  return resultOptions().map((option) => option.textContent);
}

function optionKeys() {
  return resultOptions().map((option) => option.getAttribute('data-option-key'));
}

function personKeys() {
  return optionKeys().filter((key) => key?.startsWith('people|'));
}

function freshTitles() {
  return resultOptions()
    .filter((option) => option.getAttribute('data-fresh') === 'true')
    .map((option) => option.textContent);
}

function shows(text: string) {
  return screen.queryByText(text) !== null;
}

function retryRow() {
  return document.querySelector<HTMLElement>('[data-testid="mention-panel-retry"]');
}

function typedQueries(search: SearchMock) {
  return search.mock.calls.map(([request]) => request.query ?? '').filter(Boolean);
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

function highlighted() {
  return document.querySelector<HTMLElement>('[data-selected="true"]');
}

/** Moves the highlight down to the option titled `title`, as the user would with ArrowDown. */
async function highlight(view: PanelView, title: string) {
  await placeCaretAtEnd(view.editor);
  for (let step = 0; step < 10; step += 1) {
    await pressKey('ArrowDown');
    if (highlighted()?.textContent?.startsWith(title)) break;
  }
}

async function pickWithEnter(view: PanelView, title: string) {
  await highlight(view, title);
  await pressKey('Enter');
}

const ALPHA = page('alpha', 'Alpha');
const BETA = page('beta', 'Beta');
const BUDGET = page('budget', 'Budget');
const WEEKLY_NOTES = page('weekly', 'Weekly notes');

describe('MentionPanel local lane (MEN-WEB-09)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    clearMentionSearchCacheForTests();
    clearMentionLocalIndex();
    clearMentionSessionPersonPicks();
    localStorage.clear();
    localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
    mockPanelContext.searchText = '';
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
    Object.keys(mockEditorContext).forEach((key) => delete mockEditorContext[key]);
    mockEditorContext.workspaceId = WORKSPACE;
    Element.prototype.scrollIntoView = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    clearMentionLocalIndex();
    updateServerInfo(SERVER_URL, SERVER_INFO_LOADING);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("a page this tab just created ('Zebra plan')", () => {
    beforeEach(() => {
      setMentionIndexSources(WORKSPACE, { outline: [view('budget', 'Budget')] });
      // What `addPage` records when this tab creates a page (usePageOperations, MEN-WEB-07).
      recordMentionViewCreated(WORKSPACE, { viewId: 'zebra', name: 'Zebra plan', layout: ViewLayout.Document });
    });

    const search = () =>
      createSearch((lane) =>
        lane === 'bare' ? { delayMs: 50, response: pages(BUDGET) } : { delayMs: 300, response: EMPTY }
      );

    it("is listed for '@zeb' in the keystroke's own render, flagged fresh, and stays after an answer without it", async () => {
      const mock = search();
      const view = await openPanel(mock);

      type(view, 'zeb');
      expect(titles()).toEqual(['Zebra plan']);
      expect(freshTitles()).toEqual(['Zebra plan']);

      await advance(1_000);
      expect(typedQueries(mock)).toEqual(['zeb', 'zeb']);
      expect(titles()).toEqual(['Zebra plan']);
      expect(freshTitles()).toEqual(['Zebra plan']);
      expect(shows('findAndReplace.noResult')).toBe(false);
    });

    it('is inserted as the server would insert it, and reported as the local lane pick', async () => {
      const view = await openPanel(search());

      type(view, 'zeb');
      await advance(1_000);
      await pickWithEnter(view, 'Zebra plan');

      expect(mockAddMark).toHaveBeenCalledWith(
        view.editor,
        expect.objectContaining({ value: expect.objectContaining({ type: MentionType.PageRef, page_id: 'zebra' }) })
      );

      cleanup();
      await act(async () => {
        await Promise.resolve();
      });

      const session = mockReport.mock.calls[0]?.[1] as MentionPickerSession | undefined;

      expect(session).toMatchObject({ outcome: 'selected', selected_rank: 1, selected_source: 'local' });
    });

    it('is not listed until the server lists it with the local lane off, or with the v2 off', async () => {
      localStorage.setItem(MENTION_LOCAL_LANE_OVERRIDE_KEY, 'false');

      let view = await openPanel(search());

      type(view, 'zeb');
      await advance(1_000);
      expect(titles()).toEqual([]);
      expect(shows('findAndReplace.noResult')).toBe(true);

      cleanup();
      clearMentionSearchCacheForTests();
      localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'false');
      view = await openPanel(search());
      type(view, 'zeb');
      await advance(1_000);
      expect(titles()).toEqual([]);
      expect(shows('findAndReplace.noResult')).toBe(true);
    });
  });

  it("sends no typed request for '@z' that the one-letter rule keeps local, and lists the local matches", async () => {
    localStorage.setItem(MENTION_SCHEDULER_MODE_OVERRIDE_KEY, 'contract');
    localStorage.setItem(MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY, 'true');
    setMentionIndexSources(WORKSPACE, { outline: [view('zebra', 'Zebra plan'), view('budget', 'Budget')] });

    const mock = createSearch((lane) =>
      lane === 'bare' ? { delayMs: 50, response: pages(BUDGET) } : { delayMs: 80, response: EMPTY }
    );
    const panel = await openPanel(mock);

    type(panel, 'z');
    expect(titles()).toEqual(['Zebra plan']);

    await advance(1_000);
    expect(typedQueries(mock)).toEqual([]);
    expect(titles()).toEqual(['Zebra plan']);
    expect(shows('findAndReplace.noResult')).toBe(false);

    // A letter nothing matches says so, without a request either.
    type(panel, 'q');
    await advance(1_000);
    expect(typedQueries(mock)).toEqual([]);
    expect(shows('findAndReplace.noResult')).toBe(true);
  });

  describe('people on the page', () => {
    const ANNA = roster(1, 'Anna');
    const ANDREA = roster(2, 'Andrea');

    function peopleSearch() {
      return createSearch((lane) =>
        lane === 'primary'
          ? { delayMs: 300, response: people(personItem(ANNA), personItem(ANDREA)) }
          : { delayMs: 50, response: EMPTY }
      );
    }

    it('rank a collaborator on the page first among people of the same class, before and after the answer', async () => {
      setMentionIndexSources(WORKSPACE, { outline: [] });
      recordMentionRoster(WORKSPACE, [ANNA, ANDREA, roster(99, 'Me')]);
      mockEditorContext.awareness = awarenessOf([
        { name: 'Andrea', uuid: ANDREA.person_id },
        { name: 'Me', uuid: ME },
      ]);

      const panel = await openPanel(peopleSearch());

      type(panel, 'an');
      // From the roster at once: both C0, Andrea is on the page.
      expect(personKeys()).toEqual([`people|person:${ANDREA.person_id}`, `people|person:${ANNA.person_id}`]);

      await advance(1_000);
      expect(personKeys()).toEqual([`people|person:${ANDREA.person_id}`, `people|person:${ANNA.person_id}`]);
    });

    it("keep the server's order without anyone on the page, and count a collaborator the roster lacks", async () => {
      setMentionIndexSources(WORKSPACE, { outline: [] });
      recordMentionRoster(WORKSPACE, [ANNA]);

      let panel = await openPanel(peopleSearch());

      type(panel, 'an');
      await advance(1_000);
      expect(personKeys()).toEqual([`people|person:${ANNA.person_id}`, `people|person:${ANDREA.person_id}`]);

      cleanup();
      clearMentionSearchCacheForTests();
      mockEditorContext.awareness = awarenessOf([{ name: 'Andrea', uuid: ANDREA.person_id }]);
      panel = await openPanel(peopleSearch());
      type(panel, 'an');
      await advance(1_000);
      expect(personKeys()).toEqual([`people|person:${ANDREA.person_id}`, `people|person:${ANNA.person_id}`]);
    });
  });

  describe('the bare @', () => {
    it('lists a page opened 2 s ago first, in the cached paint and in an answer from a replica that lacks it', async () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [view('alpha', 'Alpha'), view('beta', 'Beta'), view('gamma', 'Gamma'), view('delta', 'Delta')],
      });
      // An open long before the answers, which they reflect.
      recordMentionViewOpened(WORKSPACE, 'delta', Date.now() - 5 * 60_000);

      // Another replica's answer, which has not seen this tab's latest open.
      const mock = createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: pages(ALPHA, BETA) } : NEVER));
      const panel = await openPanel(mock);

      expect(titles()).toEqual(['Alpha', 'Beta']);

      // The answer is cached; a minute later the user opens Gamma, then types `@` again.
      await advance(70_000);
      recordMentionViewOpened(WORKSPACE, 'gamma');
      await advance(2_000);
      await reopen(panel);
      expect(titles()).toEqual(['Gamma', 'Alpha', 'Beta']);

      // The cached answer is refreshed, and the replica still lacks Gamma.
      await advance(100);
      expect(mock.mock.calls.filter(([request]) => !request.query)).toHaveLength(2);
      expect(titles()).toEqual(['Gamma', 'Alpha', 'Beta']);
    });

    // Cloud's bare answer lists only the requester's opens and the page being edited, so it never
    // lists a page this tab created and nobody opened, however new the answer is. In a document the
    // page modal opens a new sub-page, which counts as an open; a row page's or a Feed card's editor
    // offers no modal, so a sub-page added there stays unopened.
    describe('a sub-page this tab created and never opened', () => {
      beforeEach(() => {
        mockEditorContext.viewId = 'doc';
        mockEditorContext.mentionContext = { view_id: 'doc' };
        setMentionIndexSources(WORKSPACE, {
          outline: [view('doc', 'Doc'), view('alpha', 'Alpha'), view('beta', 'Beta')],
        });
      });

      const bareSearch = (delayMs: number) =>
        createSearch((lane) =>
          lane === 'bare' ? { delayMs, response: pages(page('doc', 'Doc'), ALPHA, BETA) } : NEVER
        );
      // What `addPage` records for the slash menu's sub-page (`createSubpage`) in an editor with no
      // page modal, where nothing opens it.
      const createSubpage = (at = Date.now()) =>
        recordMentionViewCreated(
          WORKSPACE,
          { viewId: 'sub', name: 'Sub page', layout: ViewLayout.Document, parentViewId: 'doc' },
          at
        );

      it('is listed first when created before the answer cutoff, for 15 minutes', async () => {
        createSubpage(Date.now() - 90_000);

        const panel = await openPanel(bareSearch(50));

        expect(titles()).toEqual(['Sub page', 'Doc', 'Alpha', 'Beta']);
        expect(freshTitles()).toEqual(['Sub page']);

        // Fifteen minutes after its creation it leaves the bare `@`; a typed query still finds it.
        await advance(MENTION_BARE_CREATION_LIFT_MS - 90_000 + 1_000);
        await reopen(panel, 100);
        expect(titles()).toEqual(['Doc', 'Alpha', 'Beta']);

        type(panel, 'sub');
        expect(titles()).toEqual(['Sub page']);
      });

      it('stays listed and highlighted from the cached paint through the refresh, and Enter inserts it', async () => {
        const mock = bareSearch(300);
        const panel = await openPanel(mock, 400);

        expect(titles()).toEqual(['Doc', 'Alpha', 'Beta']);

        // A minute later the user adds the sub-page, and a minute after that types `@` again: the
        // cached answer predates the creation, and the refreshed one arrives over a minute after it.
        await advance(60_000);
        createSubpage();
        await advance(60_000);
        await reopen(panel);
        expect(titles()).toEqual(['Sub page', 'Doc', 'Alpha', 'Beta']);

        await highlight(panel, 'Sub page');
        expect(highlighted()?.textContent).toBe('Sub page');

        await advance(400);
        expect(mock.mock.calls.filter(([request]) => !request.query)).toHaveLength(2);
        expect(titles()).toEqual(['Sub page', 'Doc', 'Alpha', 'Beta']);
        expect(highlighted()?.textContent).toBe('Sub page');

        await pressKey('Enter');
        expect(mockAddMark).toHaveBeenCalledTimes(1);
        expect(mockAddMark.mock.calls[0][1].value).toEqual(
          expect.objectContaining({ type: MentionType.PageRef, page_id: 'sub' })
        );
      });
    });

    // The picker lists databases after the pages, as it lists the server's (the folded layout,
    // foldMentionSectionsIntoPages).
    it('lifts a database this tab opened to the top of the databases, which follow the pages', async () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [
          view('alpha', 'Alpha'),
          view('beta', 'Beta'),
          view('grid', 'Tasks', { layout: ViewLayout.Grid, extra: { is_space: false, database_id: 'db' } }),
          view('budget-grid', 'Budget', { layout: ViewLayout.Grid, extra: { is_space: false, database_id: 'budget' } }),
        ],
      });
      recordMentionViewOpened(WORKSPACE, 'grid', Date.now() - 2_000);

      const budget: MentionSearchResultItem = {
        kind: MentionTargetKind.Database,
        object_id: 'budget',
        title: 'Budget',
        database_id: 'budget',
        database_view_id: 'budget-grid',
        mention: { type: MentionTargetKind.Database, database_id: 'budget', database_view_id: 'budget-grid' },
      };
      // Another replica's answer, which has not seen the open of Tasks.
      const answer: MentionSearchResponse = {
        sections: [
          section(MentionSearchSectionKind.Pages, [ALPHA, BETA]),
          section(MentionSearchSectionKind.Databases, [budget]),
        ],
      };

      await openPanel(createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: answer } : NEVER)));
      expect(optionKeys()).toEqual([
        'pages|page:alpha',
        'pages|page:beta',
        'pages|database:db:grid',
        'pages|database:budget:budget-grid',
      ]);
      expect(titles()).toEqual(['Alpha', 'Beta', 'Tasks', 'Budget']);
    });

    it('keeps the server order with the local lane off', async () => {
      localStorage.setItem(MENTION_LOCAL_LANE_OVERRIDE_KEY, 'false');
      setMentionIndexSources(WORKSPACE, {
        outline: [view('alpha', 'Alpha'), view('beta', 'Beta'), view('gamma', 'Gamma')],
      });
      recordMentionViewOpened(WORKSPACE, 'gamma');

      await openPanel(createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: pages(ALPHA, BETA) } : NEVER)));
      expect(titles()).toEqual(['Alpha', 'Beta']);
    });

    it("lists this tab's person picks first next time, then up to three people on the page", async () => {
      const [anna, bob, cy, dee, eve, fay] = ['Anna', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay'].map((name, n) =>
        roster(n + 1, name)
      );
      const me = roster(99, 'Me');

      setMentionIndexSources(WORKSPACE, { outline: [] });
      recordMentionRoster(WORKSPACE, [anna, bob, cy, dee, eve, fay, me]);
      mockEditorContext.awareness = awarenessOf(
        [cy, dee, eve, fay, me].map((entry) => ({ name: entry.name, uuid: entry.person_id }))
      );

      const mock = createSearch((lane, query) => {
        if (lane === 'bare') return { delayMs: 50, response: people(personItem(anna), personItem(bob), personItem(me)) };
        if (lane === 'rows') return { delayMs: 50, response: EMPTY };
        return { delayMs: 50, response: query === 'bo' ? people(personItem(bob)) : EMPTY };
      });
      const panel = await openPanel(mock);
      const keysOf = (...entries: MentionablePerson[]) => entries.map((entry) => `people|person:${entry.person_id}`);

      // Up to three people on the page come first, by name since the answer lists none of them.
      expect(personKeys()).toEqual(keysOf(cy, dee, eve, anna, bob, me));

      type(panel, 'bo');
      await advance(500);
      await pickWithEnter(panel, 'Bob');
      expect(mockAddMark).toHaveBeenCalledWith(
        panel.editor,
        expect.objectContaining({
          value: expect.objectContaining({ type: MentionType.Person, person_id: bob.person_id }),
        })
      );

      // The requester stays last, where the server puts them.
      await reopen(panel, 100);
      expect(personKeys()).toEqual(keysOf(bob, cy, dee, eve, anna, me));
    });
  });

  it('caps a provisional section at the limit, as the v2 does without the lane', async () => {
    setMentionIndexSources(WORKSPACE, { outline: [] });
    recordMentionViewCreated(WORKSPACE, { viewId: 'trip', name: 'Road trip', layout: ViewLayout.Document });

    const bare = Array.from({ length: 20 }, (_, n) => page(`b${n}`, `Road ${n}`));
    const typed = Array.from({ length: 20 }, (_, n) => page(`t${n}`, `Road ${20 + n}`));
    const panel = await openPanel(
      createSearch((lane, query) => {
        if (lane === 'bare') return { delayMs: 50, response: pages(...bare) };
        if (query !== 'r') return NEVER;
        return { delayMs: 50, response: lane === 'primary' ? pages(...typed) : EMPTY };
      })
    );

    type(panel, 'r');
    await advance(500);
    // `ro` narrows the 40 pages the answers hold, which the provisional list caps at 20.
    type(panel, 'ro');
    await act(async () => {
      fireEvent.click(document.querySelector('[data-option-key="pages|more"]') as HTMLElement);
    });
    // The page this tab just created ranks first in its tier, by recency, and keeps a place.
    expect(titles()).toHaveLength(20);
    expect(titles()[0]).toBe('Road trip');
  });

  it("finds '产品路线图' for '@路线' at once, and keeps it after an answer that omits it", async () => {
    setMentionIndexSources(WORKSPACE, { outline: [view('roadmap-cn', '产品路线图'), view('meeting', '会议')] });

    const panel = await openPanel(
      createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: EMPTY } : { delayMs: 300, response: EMPTY }))
    );

    type(panel, '路线');
    expect(titles()).toEqual(['产品路线图']);

    await advance(1_000);
    expect(titles()).toEqual(['产品路线图']);
  });

  it('ranks a body-only server hit below a local title-prefix hit, which the lane off leaves out', async () => {
    setMentionIndexSources(WORKSPACE, { outline: [view('trip', 'Road trip')] });

    const reply = (lane: Lane): Reply =>
      lane === 'primary' ? { delayMs: 300, response: pages(WEEKLY_NOTES) } : { delayMs: 50, response: EMPTY };
    let panel = await openPanel(createSearch(reply));

    type(panel, 'road');
    await advance(1_000);
    expect(titles()).toEqual(['Road trip', 'Weekly notes']);

    cleanup();
    clearMentionSearchCacheForTests();
    localStorage.setItem(MENTION_LOCAL_LANE_OVERRIDE_KEY, 'false');
    panel = await openPanel(createSearch(reply));
    type(panel, 'road');
    await advance(1_000);
    expect(titles()).toEqual(['Weekly notes']);
  });

  describe('a server that fails', () => {
    beforeEach(() =>
      setMentionIndexSources(WORKSPACE, { outline: [view('trip', 'Road trip'), view('budget', 'Budget')] })
    );

    it('shows the local matches with the unavailable row on a 500, never No result', async () => {
      const panel = await openPanel(
        createSearch((lane) => {
          if (lane === 'primary') return { delayMs: 200, error: { code: 500, message: 'internal error' } };
          return { delayMs: 50, response: EMPTY };
        })
      );

      type(panel, 'road');
      expect(titles()).toEqual(['Road trip']);

      await advance(1_000);
      expect(titles()).toEqual(['Road trip']);
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
      expect(shows('findAndReplace.noResult')).toBe(false);
    });

    it('shows them too when every request stalls past its deadline', async () => {
      const panel = await openPanel(
        createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: EMPTY } : NEVER))
      );

      type(panel, 'road');
      await advance(MENTION_TYPED_DEADLINE_MS + 500);
      expect(titles()).toEqual(['Road trip']);
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
      expect(shows('findAndReplace.noResult')).toBe(false);
    });

    it("lists this tab's recent pages on a bare @ that fails, with the unavailable row", async () => {
      recordMentionViewOpened(WORKSPACE, 'budget');
      await openPanel(
        createSearch(() => ({ delayMs: 50, error: { code: 500, message: 'internal error' } })),
        200
      );

      expect(titles()).toEqual(['Budget']);
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
    });
  });

  it("shows a page under the name this tab gave it, and inserts the server's payload", async () => {
    setMentionIndexSources(WORKSPACE, { outline: [view('trip', 'Road trip')] });
    // What `updatePageName` records; the index has not caught up with it.
    recordMentionViewRenamed(WORKSPACE, 'trip', 'Road trip 2027');

    const panel = await openPanel(
      createSearch((lane) =>
        lane === 'primary'
          ? { delayMs: 100, response: pages(page('trip', 'Road trip')) }
          : { delayMs: 50, response: EMPTY }
      )
    );

    type(panel, 'road');
    await advance(1_000);
    expect(titles()).toEqual(['Road trip 2027']);

    await pickWithEnter(panel, 'Road trip 2027');
    expect(mockAddMark).toHaveBeenCalledWith(
      panel.editor,
      expect.objectContaining({
        value: expect.objectContaining({ page_id: 'trip', data: expect.objectContaining({ title: 'Road trip 2027' }) }),
      })
    );
  });

  it('merges a database this tab just created with the server item for it, whose view it lacks', async () => {
    setMentionIndexSources(WORKSPACE, { outline: [view('space', 'General', { extra: { is_space: true } })] });
    recordMentionViewCreated(WORKSPACE, {
      viewId: 'container',
      name: 'Road tasks',
      layout: ViewLayout.Grid,
      parentViewId: 'space',
      databaseId: 'db',
    });

    const database: MentionSearchResultItem = {
      kind: MentionTargetKind.Database,
      object_id: 'db',
      title: 'Untitled',
      database_id: 'db',
      database_view_id: 'grid',
      mention: { type: MentionTargetKind.Database, database_id: 'db', database_view_id: 'grid' },
    };
    const panel = await openPanel(
      createSearch((lane) =>
        lane === 'primary'
          ? { delayMs: 100, response: { sections: [section(MentionSearchSectionKind.Databases, [database])] } }
          : { delayMs: 50, response: EMPTY }
      )
    );

    type(panel, 'road');
    expect(optionKeys()).toEqual(['pages|database:db:-']);

    await advance(1_000);
    expect(optionKeys()).toEqual(['pages|database:db:grid']);
    expect(titles()).toEqual(['Road tasks']);
  });

  describe('a database this tab just created, whose view the outline has not listed', () => {
    beforeEach(() => {
      setMentionIndexSources(WORKSPACE, {
        outline: [view('space', 'General', { extra: { is_space: true } }), view('map', 'Road map')],
      });
      // What `addPage` records for a new Grid: the container it created, and its database.
      recordMentionViewCreated(WORKSPACE, {
        viewId: 'container',
        name: 'Road tasks',
        layout: ViewLayout.Grid,
        parentViewId: 'space',
        databaseId: 'db',
      });
    });

    const serverDatabase: MentionSearchResultItem = {
      kind: MentionTargetKind.Database,
      object_id: 'db',
      title: 'Road tasks',
      database_id: 'db',
      database_view_id: 'grid',
      mention: { type: MentionTargetKind.Database, database_id: 'db', database_view_id: 'grid' },
    };

    it('is inserted before any answer as a mention of the view it created, which every client opens', async () => {
      const panel = await openPanel(
        createSearch((lane) => (lane === 'bare' ? { delayMs: 50, response: EMPTY } : NEVER))
      );

      type(panel, 'road');
      expect(optionKeys()).toEqual(['pages|page:map', 'pages|database:db:-']);

      await pickWithEnter(panel, 'Road tasks');
      // Its page is the container, never the database id, which names no view.
      expect(mockAddMark).toHaveBeenCalledTimes(1);
      expect(mockAddMark.mock.calls[0][1].value).toEqual({
        type: MentionType.PageRef,
        page_id: 'container',
        database_id: 'db',
        data: { title: 'Road tasks' },
      });
    });

    it('keeps the highlight when the answer names its view, and Enter inserts the server item', async () => {
      const answer: MentionSearchResponse = {
        sections: [
          section(MentionSearchSectionKind.Pages, [page('map', 'Road map')]),
          section(MentionSearchSectionKind.Databases, [serverDatabase]),
        ],
      };
      const panel = await openPanel(
        createSearch((lane) =>
          lane === 'primary' ? { delayMs: 400, response: answer } : { delayMs: 50, response: EMPTY }
        )
      );

      type(panel, 'road');
      await highlight(panel, 'Road tasks');
      expect(highlighted()?.getAttribute('data-option-key')).toBe('pages|database:db:-');

      await advance(1_000);
      expect(optionKeys()).toEqual(['pages|page:map', 'pages|database:db:grid']);
      expect(highlighted()?.getAttribute('data-option-key')).toBe('pages|database:db:grid');

      await pressKey('Enter');
      expect(mockAddMark).toHaveBeenCalledTimes(1);
      expect(mockAddMark.mock.calls[0][1].value).toEqual(
        expect.objectContaining({ page_id: 'grid', database_id: 'db', database_view_id: 'grid' })
      );
    });
  });

  // The editor's own page is rarely its own mention target: Search gives it no personal score, and
  // the lane no recency, although opening it made it this tab's latest open.
  describe('the page being edited', () => {
    beforeEach(() => {
      mockEditorContext.viewId = 'current';
      mockEditorContext.mentionContext = { view_id: 'current' };
      setMentionIndexSources(WORKSPACE, {
        outline: [
          view('current', 'Road trip'),
          view('atlas', 'Road atlas'),
          view('map', 'Road map'),
          view('alpha', 'Alpha'),
          view('beta', 'Beta'),
        ],
      });
      // The user opened Road map, then came back to the page being edited, which `loadView` records too.
      recordMentionViewOpened(WORKSPACE, 'map', Date.now() - 2_000);
      recordMentionViewOpened(WORKSPACE, 'current', Date.now() - 1_000);
    });

    it('stays where the server puts it on the bare @, so the page opened just before it comes first', async () => {
      // Search lists the page being edited first; this replica has not seen the open of Road map.
      await openPanel(
        createSearch((lane) =>
          lane === 'bare' ? { delayMs: 50, response: pages(page('current', 'Road trip'), ALPHA, BETA) } : NEVER
        )
      );

      expect(titles()).toEqual(['Road map', 'Road trip', 'Alpha', 'Beta']);
    });

    it("is not among this tab's opens on a bare @ that fails", async () => {
      await openPanel(
        createSearch(() => ({ delayMs: 50, error: { code: 500, message: 'internal error' } })),
        200
      );

      expect(titles()).toEqual(['Road map']);
      expect(retryRow()?.getAttribute('data-status')).toBe('unavailable');
    });

    it('gets no recency in a typed query, while a page this tab opened still does', async () => {
      // Search gives the page being edited no personal score.
      const answer = pages(page('atlas', 'Road atlas'), page('current', 'Road trip'), page('map', 'Road map'));
      const panel = await openPanel(
        createSearch((lane) =>
          lane === 'primary' ? { delayMs: 100, response: answer } : { delayMs: 50, response: EMPTY }
        )
      );

      type(panel, 'road');
      await advance(1_000);
      expect(titles()).toEqual(['Road map', 'Road atlas', 'Road trip']);
    });
  });

  // Search also matches a database by the name of the view that reached it, which the item does not
  // carry, so the client keeps the server's Databases order (MEN-WEB-08); local-only ones follow.
  it("keeps the server's order of databases, and lists local-only databases after them", async () => {
    setMentionIndexSources(WORKSPACE, {
      outline: [
        view('local-grid', 'Road budget', {
          layout: ViewLayout.Grid,
          extra: { is_space: false, database_id: 'local-db' },
        }),
      ],
    });

    const database = (id: string, title: string): MentionSearchResultItem => ({
      kind: MentionTargetKind.Database,
      object_id: id,
      title,
      database_id: id,
      database_view_id: `${id}-grid`,
      mention: { type: MentionTargetKind.Database, database_id: id, database_view_id: `${id}-grid` },
    });
    // `Tasks` reached the answer through its view `Road board`.
    const answer = {
      sections: [
        section(MentionSearchSectionKind.Databases, [database('tasks', 'Tasks'), database('road', 'Road tasks')]),
      ],
    };
    const panel = await openPanel(
      createSearch((lane) =>
        lane === 'primary' ? { delayMs: 100, response: answer } : { delayMs: 50, response: EMPTY }
      )
    );

    type(panel, 'road');
    await advance(1_000);
    expect(titles()).toEqual(['Tasks', 'Road tasks', 'Road budget']);
  });

  it('keeps a page the user lost access to out of the lane, and the pages below it', async () => {
    const emitter = new EventEmitter();

    mockEditorContext.eventEmitter = emitter;
    setMentionIndexSources(WORKSPACE, {
      outline: [view('projects', 'Road projects', { children: [view('trip', 'Road trip')] }), view('map', 'Roadmap')],
    });

    const reply = (lane: Lane): Reply =>
      lane === 'bare' ? { delayMs: 50, response: EMPTY } : { delayMs: 300, response: EMPTY };
    const panel = await openPanel(createSearch(reply));

    type(panel, 'road');
    expect(titles()).toEqual(['Roadmap', 'Road trip', 'Road projects']);

    act(() => {
      emitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'projects' });
    });
    expect(titles()).toEqual(['Roadmap']);

    await advance(1_000);
    expect(titles()).toEqual(['Roadmap']);
  });

  it('keeps a page below one the user lost access to out of the provisional list an older answer gives', async () => {
    const emitter = new EventEmitter();

    mockEditorContext.eventEmitter = emitter;
    setMentionIndexSources(WORKSPACE, {
      outline: [view('projects', 'Projects', { children: [view('trip', 'Road trip')] }), view('map', 'Roadmap')],
    });

    // The bare answer lists the page below `Projects`; typed answers never come.
    const panel = await openPanel(
      createSearch((lane) =>
        lane === 'bare' ? { delayMs: 50, response: pages(page('trip', 'Road trip'), page('map', 'Roadmap')) } : NEVER
      )
    );

    expect(titles()).toEqual(['Road trip', 'Roadmap']);

    act(() => {
      emitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: 'projects' });
    });

    type(panel, 'road');
    expect(titles()).toEqual(['Roadmap']);
  });

  // Cloud signals a space, member or group change to every user (ObjectAccessChanged), which the app
  // turns into PERMISSION_CHANGED naming no view the user lost. The outline reloads without the
  // space's pages, and the app's sources hook tells the index (`recordMentionAccessChanged`).
  it('keeps a page only the recent views loaded before list out of the lane after an access change', async () => {
    const emitter = new EventEmitter();
    const secret = view('secret', 'Roadmap secret', { parent_view_id: 'space' });
    const recent = [secret];

    mockEditorContext.eventEmitter = emitter;
    emitter.on(APP_EVENTS.PERMISSION_CHANGED, () => recordMentionAccessChanged(WORKSPACE));
    setMentionIndexSources(WORKSPACE, {
      outline: [view('space', 'Team space', { children: [secret], extra: { is_space: true } as View['extra'] })],
      recent,
    });
    setMentionIndexSources(WORKSPACE, { outline: [], recent });
    act(() => {
      emitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'space', reason: 0 });
    });

    // The server answers for a user who can no longer read the page.
    const panel = await openPanel(
      createSearch((lane) =>
        lane === 'bare'
          ? { delayMs: 50, response: pages(ALPHA) }
          : { delayMs: 200, response: pages(page('a', 'Road A')) }
      )
    );

    type(panel, 'road');
    expect(titles()).toEqual([]);
    await advance(1_000);
    expect(titles()).toEqual(['Road A']);

    // Recent views loaded since list it again: the user can read it.
    act(() => {
      setMentionIndexSources(WORKSPACE, { outline: [], recent: [secret] });
    });
    expect(titles()).toEqual(['Road A', 'Roadmap secret']);
  });

  describe('client_features', () => {
    const advertise = (features: string[]) =>
      updateServerInfo(SERVER_URL, {
        status: 'available',
        info: { enable_page_history: true, mention_features: features } as ServerInfo,
      });
    const features = (mock: SearchMock) => mock.mock.calls.map(([request]) => request.client_features);

    it('carries the opt-ins the server advertises and the picker handles, on every lane', async () => {
      advertise(['session_metrics_v1', 'typeahead_deadline_v1', 'unknown_v9', 'section_degradation_v1']);

      const mock = createSearch(() => ({ delayMs: 50, response: EMPTY }));
      const panel = await openPanel(mock);

      type(panel, 'road');
      await advance(500);
      expect(features(mock)).toEqual([
        ['section_degradation_v1', 'typeahead_deadline_v1'],
        ['section_degradation_v1', 'typeahead_deadline_v1'],
        ['section_degradation_v1', 'typeahead_deadline_v1'],
      ]);
    });

    it('are left out when the server advertises none, and with the v2 off', async () => {
      advertise(['session_metrics_v1']);

      let mock = createSearch(() => ({ delayMs: 50, response: EMPTY }));
      let panel = await openPanel(mock);

      type(panel, 'road');
      await advance(500);
      expect(mock.mock.calls.every(([request]) => !('client_features' in request))).toBe(true);

      cleanup();
      clearMentionSearchCacheForTests();
      advertise(['section_degradation_v1', 'typeahead_deadline_v1']);
      localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'false');
      mock = createSearch(() => ({ delayMs: 50, response: EMPTY }));
      panel = await openPanel(mock);
      type(panel, 'road');
      await advance(500);
      expect(mock).toHaveBeenCalledTimes(3);
      expect(mock.mock.calls.every(([request]) => !('client_features' in request))).toBe(true);
    });

    it('never cache a partial answer they asked for, which a request without them would cache', async () => {
      const partial = (lane: Lane): Reply =>
        lane === 'primary'
          ? {
              delayMs: 50,
              response: {
                sections: [section(MentionSearchSectionKind.Pages, [page('trip', 'Road trip')])],
                partial: true,
              },
            }
          : { delayMs: 50, response: EMPTY };
      const typedRequestsAfterReopening = async () => {
        const mock = createSearch(partial);
        const panel = await openPanel(mock);

        type(panel, 'road');
        await advance(500);
        await reopen(panel, 100);
        type(panel, 'road');
        await advance(500);
        cleanup();
        return typedQueries(mock).length;
      };

      // Without opt-ins the partial answer is cached, so the second `road` sends nothing.
      expect(await typedRequestsAfterReopening()).toBe(2);

      clearMentionSearchCacheForTests();
      advertise(['section_degradation_v1']);
      expect(await typedRequestsAfterReopening()).toBe(4);
    });
  });
});
