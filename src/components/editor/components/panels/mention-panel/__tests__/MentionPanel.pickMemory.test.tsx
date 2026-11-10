import { EventEmitter } from 'events';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import {
  MENTION_FEATURE_SESSION_METRICS_V1,
  MentionPickerSessionReport,
  resetMentionSessionMetricsForTests,
} from '@/application/services/js-services/http/mention-presentation-metrics';
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
  View,
  ViewLayout,
} from '@/application/types';
import { PanelProvider } from '@/components/editor/components/panels/PanelsContext';
import { getConfigValue } from '@/utils/runtime-config';
import { SERVER_INFO_LOADING, updateServerInfo } from '@/utils/server-info';

import { clearMentionLocalIndex, recordMentionRoster, setMentionIndexSources } from '../mentionLocalIndex';
import { MentionPanel } from '../MentionPanel';
import { MENTION_PICK_MEMORY_OVERRIDE_KEY, MENTION_PICK_MEMORY_STORAGE_PREFIX } from '../mentionPickMemory';
import { clearMentionSearchCacheForTests } from '../mentionSearchCache';
import { MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY, MENTION_SCHEDULER_MODE_OVERRIDE_KEY } from '../mentionSearchScheduler';
import { MENTION_TYPEAHEAD_V2_OVERRIDE_KEY } from '../mentionTypeaheadFlag';

const mockAddMark = jest.fn();
const mockPost = jest.fn();
const mockEditorContext: Record<string, unknown> = {};
const mockCurrentUser = {
  uid: '7',
  uuid: '00000000-0000-4000-8000-0000000000aa',
  email: 'me@appflowy.io',
  name: 'Me',
  avatar: null,
  latestWorkspaceId: 'workspace',
};

jest.mock('@/application/services/js-services/http/core', () => ({ getAxios: () => ({ post: mockPost }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: {} }));
jest.mock('../useNotifyPersonMention', () => ({ useNotifyPersonMention: () => jest.fn() }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { addMark: (...args: unknown[]) => mockAddMark(...args) },
}));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => mockEditorContext }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => mockCurrentUser }));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid='mention-panel'>{children}</div> : null,
  calculateOptimalOrigins: () => ({ transformOrigin: { vertical: 'top', horizontal: 'left' } }),
}));
// jsdom has no DOM Range geometry; the panels open at the editor's bounds.
jest.mock('@/components/editor/components/toolbar/selection-toolbar/utils', () => ({
  ...jest.requireActual('@/components/editor/components/toolbar/selection-toolbar/utils'),
  getRangeRect: () => null,
}));

const SERVER_URL = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
const WORKSPACE = 'workspace';
const STORAGE_KEY = `${MENTION_PICK_MEMORY_STORAGE_PREFIX}:${WORKSPACE}:7`;
const ANSWER_MS = 40;
const TYPING_DEBOUNCE_MS = 120;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function page(n: number, title: string): MentionSearchResultItem {
  const id = uuid(n);

  return { kind: MentionTargetKind.Page, object_id: id, title, mention: { type: MentionTargetKind.Page, page_id: id } };
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

const ROADMAP = page(1, 'Roadmap');
const ROADMAP_2026 = page(2, 'Roadmap 2026');
const ROADMAP_Q4 = page(3, 'Roadmap Q4');
const RECENT = page(9, 'Recent page');
// The database 6, answered through its grid view 5.
const ROADMAP_TRACKER: MentionSearchResultItem = {
  kind: MentionTargetKind.Database,
  object_id: uuid(6),
  title: 'Roadmap tracker',
  database_id: uuid(6),
  database_view_id: uuid(5),
  mention: { type: MentionTargetKind.Database, database_id: uuid(6), database_view_id: uuid(5) },
};
const ANNIE: MentionablePerson = {
  uid: 21,
  avatar_url: null,
  cover_image_url: null,
  custom_image_url: null,
  description: null,
  email: 'annie@appflowy.io',
  name: 'Annie Wang',
  role: MentionPersonRole.Member,
  person_id: uuid(21),
  invited: false,
  last_mentioned_at: null,
};
const ANNIE_ITEM: MentionSearchResultItem = {
  kind: MentionTargetKind.Person,
  object_id: ANNIE.person_id,
  title: ANNIE.name,
  subtitle: ANNIE.email,
  mention: { type: MentionTargetKind.Person, person_id: ANNIE.person_id, person_name: ANNIE.name, page_id: uuid(99) },
};

/** What the server finds for `ro` and for `an`; tests change them to model an index that lags. */
let typedPages: MentionSearchResultItem[];
let typedDatabases: MentionSearchResultItem[];
let typedPeople: MentionSearchResultItem[];

/** The answer to `ro`: its pages and its databases, each section only when it has items. */
function roSections(): MentionSearchSection[] {
  return [
    ...(typedPages.length > 0 ? [section(MentionSearchSectionKind.Pages, typedPages)] : []),
    ...(typedDatabases.length > 0 ? [section(MentionSearchSectionKind.Databases, typedDatabases)] : []),
  ];
}

function isRowRequest(request: MentionSearchRequest) {
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow;
}

// Answers after ANSWER_MS, or rejects as cancelled as soon as the request is aborted, like axios.
function createSearch() {
  return jest.fn(
    (request: MentionSearchRequest, options?: MentionSearchOptions) =>
      new Promise<MentionSearchResponse>((resolve, reject) => {
        const cancelled = { code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' };

        if (options?.signal?.aborted) {
          reject(cancelled);
          return;
        }

        const timer = setTimeout(() => {
          const asksForPeople = !request.include?.length || request.include.includes(MentionTargetKind.Person);

          if (!request.query) resolve({ sections: [section(MentionSearchSectionKind.Pages, [RECENT])] });
          else if (isRowRequest(request)) resolve({ sections: [] });
          else if (request.query === 'an' && asksForPeople) {
            resolve({ sections: [section(MentionSearchSectionKind.People, typedPeople)] });
          } else if (request.query === 'ro') {
            resolve({ sections: roSections() });
          } else {
            resolve({ sections: [section(MentionSearchSectionKind.Pages, [])] });
          }
        }, ANSWER_MS);

        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(cancelled);
          },
          { once: true }
        );
      })
  );
}

function renderEditor() {
  const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });

  render(
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: 'See' }] }]}>
      <PanelProvider editor={editor}>
        <Editable data-testid='editor' />
        <MentionPanel notifyOnInsert={false} />
      </PanelProvider>
    </Slate>
  );
  return editor;
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

// Types at the end of the document, as a user does.
async function type(editor: Editor, text: string) {
  await act(async () => {
    Transforms.select(editor, Editor.end(editor, []));
    for (const character of text) editor.insertText(character);
  });
}

async function pressKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('editor'), { key });
  });
}

/** Opens the picker with `trigger` and types `query`, waiting for any answer the session needs. */
async function openAndType(editor: Editor, query: string, trigger = '@') {
  await type(editor, ` ${trigger}`);
  await advance(ANSWER_MS);
  await type(editor, query);
  await advance(TYPING_DEBOUNCE_MS + ANSWER_MS);
}

async function openAndTypeRo(editor: Editor) {
  await openAndType(editor, 'ro');
}

function shownTitles() {
  return Array.from(document.querySelectorAll('[data-option-key]')).map((option) => option.textContent);
}

function shownKeys() {
  return Array.from(document.querySelectorAll('[data-option-key]')).map((option) =>
    option.getAttribute('data-option-key')
  );
}

function sectionHeadings() {
  return Array.from(document.querySelectorAll('[data-section-kind]')).map(
    (shown) => shown.querySelector(':scope > div > span')?.textContent
  );
}

/** Whether the loading skeleton stands in for the results. */
function showsLoadingState() {
  return screen.getByTestId('mention-panel').querySelector('[aria-busy="true"]') !== null;
}

function highlightedTitle() {
  return document.querySelector('[data-option-key][data-selected="true"]')?.textContent;
}

/** Highlights `title` with ArrowDown, then inserts it with Enter. */
async function pickWithEnter(title: string) {
  for (let step = 0; step < 10 && highlightedTitle() !== title; step += 1) await pressKey('ArrowDown');
  expect(highlightedTitle()).toBe(title);
  await pressKey('Enter');
}

function storedMemory(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY);

  return raw === null ? null : JSON.parse(raw);
}

function pickMemoryKeys() {
  return Object.keys(localStorage).filter((key) => key.startsWith(MENTION_PICK_MEMORY_STORAGE_PREFIX));
}

function insertedPageIds() {
  return mockAddMark.mock.calls.map(([, mark]) => (mark as { value: { page_id?: string } }).value.page_id);
}

function outlineView(n: number, name: string): View {
  return {
    view_id: uuid(n),
    name,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
  };
}

/** A grid view `n` of database `databaseN`, which the index keys as the server keys it. */
function databaseOutlineView(n: number, name: string, databaseN: number): View {
  return { ...outlineView(n, name), layout: ViewLayout.Grid, extra: { is_space: false, database_id: uuid(databaseN) } };
}

describe('MentionPanel pick memory', () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeAll(() => {
    // jsdom does not scroll; the panel scrolls the highlighted option into view.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() });
  });

  afterAll(() => {
    if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView);
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPost.mockResolvedValue({ status: 204, data: '' });
    clearMentionSearchCacheForTests();
    clearMentionLocalIndex();
    resetMentionSessionMetricsForTests();
    localStorage.clear();
    typedPages = [ROADMAP, ROADMAP_2026, ROADMAP_Q4];
    typedDatabases = [];
    typedPeople = [ANNIE_ITEM];
    Object.keys(mockEditorContext).forEach((key) => delete mockEditorContext[key]);
    mockEditorContext.workspaceId = WORKSPACE;
    mockEditorContext.searchMentions = createSearch();
  });

  afterEach(() => {
    cleanup();
    clearMentionLocalIndex();
    updateServerInfo(SERVER_URL, SERVER_INFO_LOADING);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('switched on', () => {
    beforeEach(() => localStorage.setItem(MENTION_PICK_MEMORY_OVERRIDE_KEY, 'true'));

    it("ranks 'Roadmap 2026' first in its tier after it was picked twice from @ro", async () => {
      const editor = renderEditor();

      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap 2026', 'Roadmap Q4']);
      await pickWithEnter('Roadmap 2026');
      const firstPickAt = Date.now();

      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);
      await pickWithEnter('Roadmap 2026');
      const secondPickAt = Date.now();

      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);
      expect(insertedPageIds()).toEqual([uuid(2), uuid(2)]);
      expect(secondPickAt).toBeGreaterThan(firstPickAt);

      // The device keeps the normalized input and the navigation key, nothing it showed.
      expect(storedMemory()).toEqual({ v: 1, e: [[`page:${uuid(2)}`, 'ro', 1_900_000, secondPickAt]] });
      expect(localStorage.getItem(STORAGE_KEY)).not.toMatch(/roadmap|recent|see|me@/i);
      expect(pickMemoryKeys()).toEqual([STORAGE_KEY]);
    });

    it('never reinforces what it only shows: rendering, arrowing and closing record nothing', async () => {
      const editor = renderEditor();

      await openAndTypeRo(editor);
      for (let step = 0; step < 5; step += 1) await pressKey('ArrowDown');
      await pressKey('ArrowUp');
      await pressKey('Escape');
      await openAndTypeRo(editor);
      await pressKey('Escape');

      expect(mockAddMark).not.toHaveBeenCalled();
      expect(pickMemoryKeys()).toEqual([]);
    });

    it('brings a picked page the answer lacks from the local index, at the top of its tier', async () => {
      setMentionIndexSources(WORKSPACE, { outline: [outlineView(2, 'Roadmap 2026'), outlineView(4, 'Budget')] });
      updateServerInfo(SERVER_URL, {
        status: 'available',
        info: { enable_page_history: true, mention_features: [MENTION_FEATURE_SESSION_METRICS_V1] },
      });
      const editor = renderEditor();

      await openAndTypeRo(editor);
      await pickWithEnter('Roadmap 2026');

      // The index has not caught up: the server's answer leaves the page out.
      typedPages = [ROADMAP, ROADMAP_Q4];
      clearMentionSearchCacheForTests();
      await openAndTypeRo(editor);

      expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);
      await pickWithEnter('Roadmap 2026');
      expect(insertedPageIds()).toEqual([uuid(2), uuid(2)]);
      // The session reports count the second pick as the local lane's.
      expect(
        mockPost.mock.calls.map(([, body]) => {
          const { selected_rank, selected_source } = body as MentionPickerSessionReport;

          return { selected_rank, selected_source };
        })
      ).toEqual([
        { selected_rank: 2, selected_source: 'server' },
        { selected_rank: 1, selected_source: 'local' },
      ]);
    });

    it('joins a picked page only once the answer is on screen: until then the loading state shows', async () => {
      setMentionIndexSources(WORKSPACE, { outline: [outlineView(2, 'Roadmap 2026')] });
      const editor = renderEditor();

      await openAndTypeRo(editor);
      await pickWithEnter('Roadmap 2026');

      // The index has not caught up: the server's answer will leave the page out.
      typedPages = [ROADMAP, ROADMAP_Q4];
      clearMentionSearchCacheForTests();
      await type(editor, ' @');
      await advance(ANSWER_MS);
      await type(editor, 'ro');

      // Nothing typed is answered yet, so the skeleton stands in for the results, as without picks.
      expect(shownTitles()).toEqual([]);
      expect(showsLoadingState()).toBe(true);

      await advance(TYPING_DEBOUNCE_MS + ANSWER_MS);
      expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);
      expect(showsLoadingState()).toBe(false);
    });

    it('leaves the answer to another search as it is, such as the bare one a local letter keeps', async () => {
      localStorage.setItem(MENTION_SCHEDULER_MODE_OVERRIDE_KEY, 'contract');
      localStorage.setItem(MENTION_ONE_LETTER_LOCAL_OVERRIDE_KEY, 'true');
      setMentionIndexSources(WORKSPACE, { outline: [outlineView(2, 'Roadmap 2026')] });
      const editor = renderEditor();

      await openAndTypeRo(editor);
      await pickWithEnter('Roadmap 2026');

      // `r` stays local: nothing is sent, and the bare answer stays on screen, neither ordered by
      // the pick for `ro` nor joined by it.
      await openAndType(editor, 'r');
      expect(shownTitles()).toEqual(['Recent page']);
    });

    it.each([
      ['outline', (view: View) => ({ outline: [view] })],
      ['recent views', (view: View) => ({ outline: [], recent: [view] })],
    ])('drops a page the user loses access to, and never brings it back from the %s', async (_, sources) => {
      const eventEmitter = new EventEmitter();

      mockEditorContext.eventEmitter = eventEmitter;
      // The index lists the page until its sources catch up with the revoke.
      setMentionIndexSources(WORKSPACE, sources(outlineView(2, 'Roadmap 2026')));
      const editor = renderEditor();

      await openAndTypeRo(editor);
      await pickWithEnter('Roadmap 2026');
      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);

      await act(async () => {
        eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: uuid(2) });
      });
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap Q4']);

      // The next opening: the server leaves the page out, and the index still lists it.
      await pressKey('Escape');
      typedPages = [ROADMAP, ROADMAP_Q4];
      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap Q4']);

      // Access returns: the picked page joins again.
      await act(async () => {
        eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: uuid(2) });
      });
      expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);

      // Revoked again while only the index brings it: it leaves the open panel at once too.
      await act(async () => {
        eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: uuid(2) });
      });
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap Q4']);
      expect(insertedPageIds()).toEqual([uuid(2)]);
    });

    it.each([
      ['right above it', 11, [2]],
      ['two levels above it, through a page the recent views list', 10, [2, 11]],
    ])('keeps a picked page out once the user loses access to a page %s', async (_, revokedN, recentNs) => {
      const eventEmitter = new EventEmitter();
      // Page 2 sits below page 11, below page 10.
      const picked: View = { ...outlineView(2, 'Roadmap 2026'), parent_view_id: uuid(11) };
      const plans: View = { ...outlineView(11, 'Plans'), parent_view_id: uuid(10), children: [picked] };
      const projects: View = { ...outlineView(10, 'Projects'), children: [plans] };
      const recent = [picked, { ...plans, children: [] }].filter((view) => recentNs.map(uuid).includes(view.view_id));

      mockEditorContext.eventEmitter = eventEmitter;
      setMentionIndexSources(WORKSPACE, { outline: [projects], recent });
      const editor = renderEditor();

      await openAndTypeRo(editor);
      await pickWithEnter('Roadmap 2026');

      // The server's index lags: its answer leaves the page out, and the local index brings it.
      typedPages = [ROADMAP, ROADMAP_Q4];
      clearMentionSearchCacheForTests();
      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);

      // The app names only the page whose share changed; the page below it leaves the open panel.
      await act(async () => {
        eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: uuid(revokedN) });
      });
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap Q4']);

      // The outline drops the revoked page and its subtree. The recent views reload only on demand,
      // so the index still lists what they list, and the next opening leaves the page out.
      await pressKey('Escape');
      setMentionIndexSources(WORKSPACE, { outline: revokedN === 11 ? [{ ...projects, children: [] }] : [], recent });
      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap Q4']);

      // Access returns: the picked page joins again.
      await act(async () => {
        eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: uuid(revokedN) });
      });
      expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);
      expect(insertedPageIds()).toEqual([uuid(2)]);
    });

    it.each([
      ['its container', 20],
      ['the view it answers through', 22],
    ])('drops a picked database the user loses access to, whether the app names %s', async (_, revokedN) => {
      const eventEmitter = new EventEmitter();
      const extra = { is_space: false, database_id: uuid(21) };
      // Database 21's container 20 answers through its grid view 22, as the server item shows it.
      const container: View = {
        ...outlineView(20, 'Roadmap tracker'),
        layout: ViewLayout.Grid,
        extra: { ...extra, is_database_container: true },
        children: [{ ...outlineView(22, 'Grid'), layout: ViewLayout.Grid, extra }],
      };
      const tracker: MentionSearchResultItem = {
        ...ROADMAP_TRACKER,
        object_id: uuid(21),
        database_id: uuid(21),
        database_view_id: uuid(22),
        mention: { type: MentionTargetKind.Database, database_id: uuid(21), database_view_id: uuid(22) },
      };

      mockEditorContext.eventEmitter = eventEmitter;
      setMentionIndexSources(WORKSPACE, { outline: [container] });
      typedPages = [ROADMAP];
      typedDatabases = [tracker];
      const editor = renderEditor();

      await openAndTypeRo(editor);
      await pickWithEnter('Roadmap tracker');

      // The server's index lags: its answer leaves the database out, and the local index brings it.
      typedDatabases = [];
      clearMentionSearchCacheForTests();
      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap tracker']);

      await act(async () => {
        eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: uuid(revokedN) });
      });
      expect(shownTitles()).toEqual(['Roadmap']);
    });

    it('titles a databases-only answer, and a picked database that joins an empty one, as Pages', async () => {
      setMentionIndexSources(WORKSPACE, { outline: [databaseOutlineView(5, 'Roadmap tracker', 6)] });
      typedPages = [];
      typedDatabases = [ROADMAP_TRACKER];
      const editor = renderEditor();

      await openAndTypeRo(editor);
      expect(sectionHeadings()).toEqual(['document.mention.pagesSection']);
      await pickWithEnter('Roadmap tracker');

      // The index has not caught up: nothing answers `ro`, and the picked database joins.
      typedDatabases = [];
      clearMentionSearchCacheForTests();
      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap tracker']);
      expect(sectionHeadings()).toEqual(['document.mention.pagesSection']);
    });

    it('adds a picked person the answer lacks only to a picker that lists people', async () => {
      setMentionIndexSources(WORKSPACE, { outline: [] });
      recordMentionRoster(WORKSPACE, [ANNIE]);
      const annie = `people|person:${ANNIE.person_id}`;
      const editor = renderEditor();

      await openAndType(editor, 'an');
      expect(shownKeys()).toEqual([annie]);
      await pressKey('ArrowDown');
      await pressKey('Enter');
      expect(mockAddMark).toHaveBeenCalledTimes(1);

      // The roster is refreshing, and Cloud answers without her.
      typedPeople = [];
      clearMentionSearchCacheForTests();
      await openAndType(editor, 'an');
      expect(shownKeys()).toEqual([annie]);
      await pressKey('Escape');

      // '+' links a page: it asks for no people, so she stays out.
      const search = mockEditorContext.searchMentions as jest.Mock;

      search.mockClear();
      await openAndType(editor, 'an', '+');
      expect(screen.queryByTestId('mention-panel')).not.toBeNull();
      expect(search.mock.calls.map(([request]) => [request.query, request.include])).toEqual([
        ['', [MentionTargetKind.Page, MentionTargetKind.Database]],
        ['an', [MentionTargetKind.Page, MentionTargetKind.Database]],
        ['an', [MentionTargetKind.DatabaseRow]],
      ]);
      expect(shownKeys()).toEqual([]);
    });

    it('keeps the requester last among people, even after they picked themselves', async () => {
      const me: MentionSearchResultItem = {
        ...ANNIE_ITEM,
        object_id: mockCurrentUser.uuid,
        title: 'Anna Me',
        subtitle: mockCurrentUser.email,
        mention: {
          type: MentionTargetKind.Person,
          person_id: mockCurrentUser.uuid,
          person_name: 'Anna Me',
          page_id: uuid(99),
        },
      };
      const meKey = `people|person:${mockCurrentUser.uuid}`;
      const annieKey = `people|person:${ANNIE.person_id}`;

      // Cloud lists the requester last in their class.
      typedPeople = [ANNIE_ITEM, me];
      const editor = renderEditor();

      await openAndType(editor, 'an');
      expect(shownKeys()).toEqual([annieKey, meKey]);
      await pressKey('ArrowDown');
      await pressKey('ArrowDown');
      await pressKey('Enter');

      await openAndType(editor, 'an');
      expect(shownKeys()).toEqual([annieKey, meKey]);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')?.e?.[0]?.[0]).toBe(
        `person:${mockCurrentUser.uuid}`
      );
    });

    it('keeps the server order and inserts as before when its storage throws', async () => {
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      const denied = (key: string) => key.startsWith(MENTION_PICK_MEMORY_STORAGE_PREFIX);

      // Only the pick memory's keys fail; the scheduler's and the notification switch's still work.
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
        if (denied(key)) throw new DOMException('denied', 'SecurityError');
        return getItem.call(window.localStorage, key);
      });
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
        if (denied(key)) throw new DOMException('quota', 'QuotaExceededError');
        return setItem.call(window.localStorage, key, value);
      });
      const editor = renderEditor();

      await openAndTypeRo(editor);
      await pickWithEnter('Roadmap 2026');
      await openAndTypeRo(editor);

      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap 2026', 'Roadmap Q4']);
      await pickWithEnter('Roadmap Q4');
      expect(insertedPageIds()).toEqual([uuid(2), uuid(3)]);
    });

    describe('with the picker v2 on (MEN-WEB-08)', () => {
      beforeEach(() => localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true'));

      it('joins a picked page the answer lacks, and keeps it out of the next keystroke until an answer', async () => {
        setMentionIndexSources(WORKSPACE, { outline: [outlineView(2, 'Roadmap 2026')] });
        const editor = renderEditor();

        await openAndTypeRo(editor);
        await pickWithEnter('Roadmap 2026');

        // The index has not caught up: the server's answer leaves the page out.
        typedPages = [ROADMAP, ROADMAP_Q4];
        clearMentionSearchCacheForTests();
        await openAndTypeRo(editor);
        expect(shownTitles()).toEqual(['Roadmap 2026', 'Roadmap', 'Roadmap Q4']);

        // The next keystroke narrows the list at once, without the page only the pick brought: picked
        // targets join an answer to what is typed, and no pick of `ro` scores `roa`.
        await type(editor, 'a');
        expect(shownTitles()).toEqual(['Roadmap', 'Roadmap Q4']);
        expect(showsLoadingState()).toBe(false);
      });

      it('narrows the bare answer at once, and joins a picked page only to the answer to what is typed', async () => {
        setMentionIndexSources(WORKSPACE, { outline: [outlineView(2, 'Roadmap 2026')] });
        const editor = renderEditor();

        await openAndTypeRo(editor);
        await pickWithEnter('Roadmap 2026');

        typedPages = [ROADMAP, ROADMAP_Q4];
        clearMentionSearchCacheForTests();
        await type(editor, ' @');
        await advance(ANSWER_MS);
        await type(editor, 'r');

        // The pick of `ro` scores `r`, but the provisional list narrows only what answers held.
        expect(shownTitles()).toEqual(['Recent page']);
        expect(showsLoadingState()).toBe(false);

        // Nothing answers `r`: the picked page joins that answer.
        await advance(TYPING_DEBOUNCE_MS + ANSWER_MS);
        expect(shownTitles()).toEqual(['Roadmap 2026']);
      });
    });
  });

  it('is off by default: the server order stays, and nothing is stored', async () => {
    const editor = renderEditor();

    await openAndTypeRo(editor);
    await pickWithEnter('Roadmap 2026');
    await openAndTypeRo(editor);
    await pickWithEnter('Roadmap 2026');
    await openAndTypeRo(editor);

    expect(shownTitles()).toEqual(['Roadmap', 'Roadmap 2026', 'Roadmap Q4']);
    expect(insertedPageIds()).toEqual([uuid(2), uuid(2)]);
    expect(pickMemoryKeys()).toEqual([]);
  });

  it('works without storage at all, when the localStorage getter throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });

    try {
      const editor = renderEditor();

      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap 2026', 'Roadmap Q4']);
      await pickWithEnter('Roadmap 2026');
      await openAndTypeRo(editor);
      expect(shownTitles()).toEqual(['Roadmap', 'Roadmap 2026', 'Roadmap Q4']);
      expect(insertedPageIds()).toEqual([uuid(2)]);
    } finally {
      cleanup();
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
      else delete (window as { localStorage?: Storage }).localStorage;
    }
  });
});
