import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import type { ServerInfo } from '@/application/services/js-services/http/auth-api';
import { resetMentionPickFeedbackForTests } from '@/application/services/js-services/http/mention-pick-feedback';
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

import { MENTION_SELECTION_MEMORY_OVERRIDE_KEY, MENTION_SUGGESTED_OVERRIDE_KEY } from '../mentionClientFeatures';
import { MENTION_ITEM_DETAILS_OVERRIDE_KEY } from '../mentionItemDetails';
import {
  clearMentionLocalIndex,
  recordMentionRoster,
  recordMentionViewCreated,
  recordMentionViewOpened,
  setMentionIndexSources,
} from '../mentionLocalIndex';
import { clearMentionSessionPersonPicks, recordMentionSessionPersonPick } from '../mentionLocalLane';
import { MentionPanel } from '../MentionPanel';
import { clearMentionSearchCacheForTests } from '../mentionSearchCache';
import { MENTION_TYPEAHEAD_V2_OVERRIDE_KEY } from '../mentionTypeaheadFlag';

const mockAddMark = jest.fn();
/** Every POST the picker sends through the API client: here only pick feedback. */
const mockPost = jest.fn();
/** Each picker session's report. */
const mockReport = jest.fn();
const WORKSPACE = 'workspace';
const MINUTE = 60_000;
const SERVER_URL = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
const FEEDBACK_URL = `/api/workspace/${WORKSPACE}/mentions/feedback`;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const ME = uuid(99);
const mockCurrentUser = { uid: '7', uuid: ME, email: 'me@appflowy.io', name: 'Me', avatar: null };
const mockPanelContext: Record<string, unknown> = {};
const mockEditorContext: Record<string, unknown> = {};

// The English copy itself, so a chip's text shows as users read it.
jest.mock('react-i18next', () => {
  const i18n = jest.requireActual('i18next').createInstance();

  i18n.init({
    lng: 'en',
    initImmediate: false,
    resources: { en: { translation: jest.requireActual('@/@types/translations/en.json') } },
  });

  const t = i18n.t.bind(i18n);

  return { useTranslation: () => ({ t, i18n }) };
});
jest.mock('@/application/services/js-services/http/core', () => ({
  getAxios: () => ({ post: (...args: unknown[]) => mockPost(...args) }),
}));
jest.mock('@/application/services/js-services/http/mention-presentation-metrics', () => ({
  ...jest.requireActual('@/application/services/js-services/http/mention-presentation-metrics'),
  reportMentionPickerSession: (...args: unknown[]) => mockReport(...args),
}));
// The item details load the roster once per opening: offline here, from an empty disk cache.
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getMentionableUsers: () => Promise.reject(new Error('offline')) },
}));
jest.mock('@/application/db', () => ({
  db: {
    workspace_member_profiles: {
      where: () => ({
        equals: () => ({ toArray: () => Promise.resolve([]), delete: () => Promise.resolve(0) }),
      }),
      bulkPut: () => Promise.resolve(),
    },
  },
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
jest.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
  AvatarFallback: () => null,
}));

type Lane = 'bare' | 'primary' | 'rows';

function laneOf(request: MentionSearchRequest): Lane {
  if (!request.query?.trim()) return 'bare';
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow ? 'rows' : 'primary';
}

/** Answers each request 50 ms later with `answer(lane, request)`. */
function createSearch(answer: (lane: Lane, request: MentionSearchRequest) => MentionSearchResponse) {
  return jest.fn(
    (request: MentionSearchRequest, options?: MentionSearchOptions) =>
      new Promise<MentionSearchResponse>((resolve, reject) => {
        const timer = setTimeout(() => resolve(answer(laneOf(request), request)), 50);

        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject({ code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' });
        });
      })
  );
}

type SearchMock = ReturnType<typeof createSearch>;

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

function rosterEntry(n: number, name: string): MentionablePerson {
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

function personItem(entry: MentionablePerson, fields: Partial<MentionSearchResultItem> = {}): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: entry.person_id,
    title: entry.name,
    subtitle: entry.email,
    mention: { type: MentionTargetKind.Person, person_id: entry.person_id, person_name: entry.name, page_id: 'doc' },
    ...fields,
  };
}

function page(id: string, title: string, fields: Partial<MentionSearchResultItem> = {}): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Page,
    object_id: id,
    title,
    mention: { type: MentionTargetKind.Page, page_id: id },
    ...fields,
  };
}

function outlineView(id: string, name: string): View {
  return {
    view_id: id,
    name,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
  };
}

const ADA_ENTRY = rosterEntry(1, 'Ada');
const BOB_ENTRY = rosterEntry(2, 'Bob');
const ADA = personItem(ADA_ENTRY);
const BOB = personItem(BOB_ENTRY);
const ROADMAP = page(uuid(10), 'Roadmap');
const BUDGET = page(uuid(11), 'Budget');
const TASKS: MentionSearchResultItem = {
  kind: MentionTargetKind.Database,
  object_id: uuid(20),
  title: 'Tasks',
  subtitle: 'Database',
  database_id: uuid(20),
  database_view_id: uuid(21),
  mention: { type: MentionTargetKind.Database, database_id: uuid(20), database_view_id: uuid(21) },
};
const CHECKLIST: MentionSearchResultItem = {
  kind: MentionTargetKind.DatabaseRow,
  object_id: uuid(31),
  title: 'Launch checklist',
  database_id: uuid(30),
  database_view_id: uuid(32),
  database_row_id: uuid(31),
  mention: { type: MentionTargetKind.DatabaseRow, database_id: uuid(30), database_view_id: uuid(32), row_id: uuid(31) },
};
const TODAY: MentionSearchResultItem = {
  kind: MentionTargetKind.Date,
  title: 'Today',
  subtitle: '2026-11-11',
  mention: { type: MentionTargetKind.Date, date: '2026-11-11T00:00:00Z' },
};

/** A bare `@` answer as every released server sends it: no Suggested section, no reasons. */
const RELEASED_BARE: MentionSearchResponse = {
  sections: [
    section(MentionSearchSectionKind.People, [ADA, BOB]),
    section(MentionSearchSectionKind.Pages, [ROADMAP, BUDGET]),
    section(MentionSearchSectionKind.Databases, [TASKS]),
    section(MentionSearchSectionKind.Dates, [TODAY]),
  ],
};
/** The same answer from a server that served `suggested_v1`: Ada, Roadmap and a row moved into Suggested. */
const SUGGESTED_BARE: MentionSearchResponse = {
  sections: [
    section(MentionSearchSectionKind.Suggested, [ADA, ROADMAP, CHECKLIST]),
    section(MentionSearchSectionKind.People, [BOB]),
    section(MentionSearchSectionKind.Pages, [BUDGET]),
    section(MentionSearchSectionKind.Databases, [TASKS]),
    section(MentionSearchSectionKind.Dates, [TODAY]),
  ],
};
const TYPED_RO: MentionSearchResponse = { sections: [section(MentionSearchSectionKind.Pages, [ROADMAP])] };
const EMPTY: MentionSearchResponse = { sections: [] };

/** Answers the bare `@` with `bare`, a typed query with Roadmap, and its rows request with nothing. */
const answering = (bare: MentionSearchResponse) => (lane: Lane) =>
  lane === 'bare' ? bare : lane === 'rows' ? EMPTY : TYPED_RO;

const EVERY_FEATURE = [
  'reasons_v1',
  'section_degradation_v1',
  'selection_memory_v1',
  'session_metrics_v1',
  'suggested_v1',
  'typeahead_deadline_v1',
];

function advertise(features: string[] | undefined) {
  updateServerInfo(SERVER_URL, {
    status: 'available',
    info: { enable_page_history: true, ...(features ? { mention_features: features } : {}) } as ServerInfo,
  });
}

function httpError(status: number) {
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: String(status),
    data: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse);
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function renderPanel() {
  const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });
  const tree = () => (
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@' }] }]}>
      <Editable data-testid='editor' />
      <MentionPanel notifyOnInsert={false} />
    </Slate>
  );
  const view = render(tree());

  return { editor, rerender: () => view.rerender(tree()) };
}

type PanelView = ReturnType<typeof renderPanel>;

/** Opens the picker on the bare `@`, then types `query` when one is given, and lets the answers arrive. */
async function openPanel(search: SearchMock, query = ''): Promise<PanelView> {
  mockEditorContext.searchMentions = search;
  mockPanelContext.searchText = '';

  const view = renderPanel();

  await advance(100);
  if (query) {
    mockPanelContext.searchText = query;
    view.rerender();
    await advance(1_000);
  }

  return view;
}

/** Ends the picker session, as closing it does, so its report is sent. */
async function endSession() {
  cleanup();
  await act(async () => {
    await Promise.resolve();
  });
}

function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-option-kind]'));
}

function optionKeys(): (string | null)[] {
  return options().map((option) => option.getAttribute('data-option-key'));
}

function sectionKinds(): (string | null)[] {
  return Array.from(document.querySelectorAll('[data-section-kind]')).map((element) =>
    element.getAttribute('data-section-kind')
  );
}

function option(key: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-option-key="${key}"]`);

  if (!found) throw new Error(`No option ${key}`);
  return found;
}

function chipOf(element: HTMLElement): string | null {
  return element.querySelector('[data-testid="mention-reason-chip"]')?.textContent ?? null;
}

function notificationSwitches() {
  return screen.queryAllByRole('switch', { name: 'Send notification' });
}

/** The features each request carried, by lane, in the order they were sent. */
function sentFeatures(search: SearchMock): [Lane, string[] | undefined][] {
  return search.mock.calls.map(([request]) => [laneOf(request), request.client_features]);
}

function feedbackBodies(): unknown[] {
  return mockPost.mock.calls.filter(([url]) => url === FEEDBACK_URL).map(([, body]) => body);
}

async function pressKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('editor'), { key });
  });
}

/** Highlights the option with `key` with ArrowDown, as a user does, and inserts it with Enter. */
async function pick(view: PanelView, key: string) {
  await act(async () => {
    Transforms.select(view.editor, Editor.end(view.editor, []));
  });
  for (let step = 0; step < 12; step += 1) {
    await pressKey('ArrowDown');
    if (document.querySelector('[data-selected="true"]')?.getAttribute('data-option-key') === key) break;
  }

  expect(document.querySelector('[data-selected="true"]')?.getAttribute('data-option-key')).toBe(key);
  await pressKey('Enter');
}

const suggestedKey = (navKey: string) => `${MentionSearchSectionKind.Suggested}|${navKey}`;
const ADA_KEY = `person:${ADA_ENTRY.person_id}`;
const BOB_KEY = `person:${BOB_ENTRY.person_id}`;
const ROADMAP_KEY = `page:${uuid(10)}`;
const BUDGET_KEY = `page:${uuid(11)}`;
const TASKS_KEY = `database:${uuid(20)}:${uuid(21)}`;
const CHECKLIST_KEY = `row:${uuid(30)}:${uuid(31)}`;

describe('MentionPanel opt-ins: Suggested, reasons and pick feedback (MEN-WEB-11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockPost.mockResolvedValue({ status: 204, data: '' });
    resetMentionPickFeedbackForTests();
    clearMentionSearchCacheForTests();
    clearMentionLocalIndex();
    clearMentionSessionPersonPicks();
    localStorage.clear();
    Object.keys(mockPanelContext).forEach((key) => delete mockPanelContext[key]);
    Object.assign(mockPanelContext, {
      activePanel: PanelType.Mention,
      activeTrigger: '@',
      isPanelOpen: (panel: PanelType) => panel === PanelType.Mention,
      panelPosition: { top: 0, left: 0 },
      searchText: '',
      closePanel: jest.fn(),
      removeContent: jest.fn(),
    });
    Object.keys(mockEditorContext).forEach((key) => delete mockEditorContext[key]);
    mockEditorContext.workspaceId = WORKSPACE;
    Element.prototype.scrollIntoView = jest.fn();
    setMentionIndexSources(WORKSPACE, { outline: [] });
  });

  afterEach(() => {
    cleanup();
    clearMentionLocalIndex();
    updateServerInfo(SERVER_URL, SERVER_INFO_LOADING);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('against a server that advertises none of them', () => {
    it('sends the requests released Web sends, whatever the switches', async () => {
      advertise(['session_metrics_v1']);
      [MENTION_SUGGESTED_OVERRIDE_KEY, MENTION_ITEM_DETAILS_OVERRIDE_KEY, MENTION_TYPEAHEAD_V2_OVERRIDE_KEY].forEach(
        (key) => localStorage.setItem(key, 'true')
      );

      const search = createSearch(answering(RELEASED_BARE));

      await openPanel(search, 'ro');
      expect(sentFeatures(search).map(([lane]) => lane)).toEqual(['bare', 'primary', 'rows']);
      expect(search.mock.calls.every(([request]) => !('client_features' in request))).toBe(true);
    });

    it('renders its answer as it does today, with the Suggested switch on, and reports no pick', async () => {
      advertise(undefined);

      const search = createSearch(() => RELEASED_BARE);
      const shown = () => ({
        sections: sectionKinds(),
        keys: optionKeys(),
        text: document.querySelector('[data-option-category]')?.textContent,
        switches: notificationSwitches().length,
      });

      await openPanel(search);

      const today = shown();

      cleanup();
      clearMentionSearchCacheForTests();
      localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true');

      const view = await openPanel(search);

      expect(shown()).toEqual(today);
      // Databases inside Pages and no row, as the folded layout shows a bare `@`.
      expect(today).toMatchObject({
        sections: ['people', 'pages', 'dates'],
        keys: [
          `people|${ADA_KEY}`,
          `people|${BOB_KEY}`,
          `pages|${ROADMAP_KEY}`,
          `pages|${BUDGET_KEY}`,
          `pages|${TASKS_KEY}`,
          'dates|date:Today',
        ],
        switches: 1,
      });

      await pick(view, `pages|${ROADMAP_KEY}`);
      expect(mockAddMark).toHaveBeenCalledTimes(1);
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe('requests', () => {
    it('carry each opt-in only on its lanes: Suggested on the bare `@`, selection memory on typed queries', async () => {
      advertise(EVERY_FEATURE);
      [MENTION_SUGGESTED_OVERRIDE_KEY, MENTION_ITEM_DETAILS_OVERRIDE_KEY, MENTION_TYPEAHEAD_V2_OVERRIDE_KEY].forEach(
        (key) => localStorage.setItem(key, 'true')
      );

      const search = createSearch(answering(SUGGESTED_BARE));

      await openPanel(search, 'ro');
      expect(sentFeatures(search)).toEqual([
        ['bare', ['reasons_v1', 'section_degradation_v1', 'suggested_v1', 'typeahead_deadline_v1']],
        ['primary', ['reasons_v1', 'section_degradation_v1', 'selection_memory_v1', 'typeahead_deadline_v1']],
        ['rows', ['reasons_v1', 'section_degradation_v1', 'selection_memory_v1', 'typeahead_deadline_v1']],
      ]);
    });

    it.each<[string, () => void, string[], [Lane, string[] | undefined][]]>([
      [
        'the Suggested switch is off',
        () => localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'true'),
        ['reasons_v1', 'suggested_v1', 'selection_memory_v1'],
        [
          ['bare', ['reasons_v1']],
          ['primary', ['reasons_v1', 'selection_memory_v1']],
          ['rows', ['reasons_v1', 'selection_memory_v1']],
        ],
      ],
      [
        'the item details, which show reasons, are off',
        () => localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true'),
        ['reasons_v1', 'suggested_v1', 'selection_memory_v1'],
        [
          ['bare', ['suggested_v1']],
          ['primary', ['selection_memory_v1']],
          ['rows', ['selection_memory_v1']],
        ],
      ],
      [
        'the picker is a page reference picker',
        () => {
          localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true');
          Object.assign(mockPanelContext, {
            activePanel: PanelType.PageReference,
            activeTrigger: '[[',
            isPanelOpen: (panel: PanelType) => panel === PanelType.PageReference,
          });
        },
        ['suggested_v1', 'selection_memory_v1'],
        [
          ['bare', undefined],
          ['primary', ['selection_memory_v1']],
          ['rows', ['selection_memory_v1']],
        ],
      ],
      [
        'the server advertises only selection memory',
        () => {
          localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true');
          localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'true');
        },
        ['selection_memory_v1'],
        [
          ['bare', undefined],
          ['primary', ['selection_memory_v1']],
          ['rows', ['selection_memory_v1']],
        ],
      ],
      [
        'the server advertises only Suggested and reasons',
        () => {
          localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true');
          localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'true');
        },
        ['reasons_v1', 'suggested_v1'],
        [
          ['bare', ['reasons_v1', 'suggested_v1']],
          ['primary', ['reasons_v1']],
          ['rows', ['reasons_v1']],
        ],
      ],
      [
        'the user declined selection memory',
        () => {
          localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'true');
          localStorage.setItem(MENTION_SELECTION_MEMORY_OVERRIDE_KEY, 'false');
        },
        ['reasons_v1', 'selection_memory_v1'],
        [
          ['bare', ['reasons_v1']],
          ['primary', ['reasons_v1']],
          ['rows', ['reasons_v1']],
        ],
      ],
    ])('leave out what the picker cannot use: %s', async (_name, arrange, advertised, expected) => {
      arrange();
      advertise(advertised);

      const search = createSearch(answering(RELEASED_BARE));

      await openPanel(search, 'ro');
      expect(sentFeatures(search)).toEqual(expected);
    });

    it('keep the answers to different opt-ins apart in the cache', async () => {
      advertise(['suggested_v1']);

      const search = createSearch((_lane, request) => (request.client_features ? SUGGESTED_BARE : RELEASED_BARE));

      // Without the switch, the bare answer is stored for requests without opt-ins.
      await openPanel(search);
      expect(sectionKinds()[0]).toBe('people');
      cleanup();

      // With it, while that answer is fresh, the bare `@` asks again, for Suggested.
      localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true');
      await openPanel(search);
      expect(sentFeatures(search)).toEqual([
        ['bare', undefined],
        ['bare', ['suggested_v1']],
      ]);
      expect(sectionKinds()[0]).toBe('suggested');
      cleanup();

      // And each opening finds its own answer again, fresh, without a request.
      localStorage.removeItem(MENTION_SUGGESTED_OVERRIDE_KEY);
      await openPanel(search);
      expect(sectionKinds()[0]).toBe('people');
      cleanup();
      localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true');
      await openPanel(search);
      expect(sectionKinds()[0]).toBe('suggested');
      expect(search).toHaveBeenCalledTimes(2);
    });
  });

  describe('the Suggested section', () => {
    beforeEach(() => {
      advertise(['suggested_v1', 'session_metrics_v1']);
      localStorage.setItem(MENTION_SUGGESTED_OVERRIDE_KEY, 'true');
    });

    it('comes first and renders each item once, a row included, under one notification switch', async () => {
      await openPanel(createSearch(() => SUGGESTED_BARE));

      expect(sectionKinds()).toEqual(['suggested', 'people', 'pages', 'dates']);
      expect(optionKeys()).toEqual([
        suggestedKey(ADA_KEY),
        suggestedKey(ROADMAP_KEY),
        suggestedKey(CHECKLIST_KEY),
        `people|${BOB_KEY}`,
        `pages|${BUDGET_KEY}`,
        `pages|${TASKS_KEY}`,
        'dates|date:Today',
      ]);
      // The switch heads Suggested, which lists Ada, and People shows none of its own.
      expect(notificationSwitches()).toHaveLength(1);
      expect(document.querySelector('[data-section-kind="suggested"]')?.querySelector('[role="switch"]')).not.toBeNull();
    });

    it('shows an item once when a server lists it in its own section too', async () => {
      await openPanel(
        createSearch(() => ({
          sections: [
            section(MentionSearchSectionKind.Suggested, [ADA, ROADMAP]),
            section(MentionSearchSectionKind.People, [ADA, BOB]),
            section(MentionSearchSectionKind.Pages, [ROADMAP, BUDGET]),
          ],
        }))
      );

      expect(optionKeys()).toEqual([
        suggestedKey(ADA_KEY),
        suggestedKey(ROADMAP_KEY),
        `people|${BOB_KEY}`,
        `pages|${BUDGET_KEY}`,
      ]);
    });

    it('keeps an item it lists out of its own section when this tab lifts it, and reports a pick from it', async () => {
      localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
      advertise(['suggested_v1', 'session_metrics_v1', 'selection_memory_v1']);
      // This tab opened Roadmap a moment ago and picked Ada: the local lane would lift both.
      recordMentionRoster(WORKSPACE, [ADA_ENTRY, BOB_ENTRY]);
      setMentionIndexSources(WORKSPACE, {
        outline: [outlineView(uuid(10), 'Roadmap'), outlineView(uuid(11), 'Budget')],
      });
      recordMentionViewOpened(WORKSPACE, uuid(10), Date.now() - 1_000);
      recordMentionSessionPersonPick(WORKSPACE, ADA_ENTRY.person_id);

      const view = await openPanel(createSearch(() => SUGGESTED_BARE));

      expect(optionKeys()).toEqual([
        suggestedKey(ADA_KEY),
        suggestedKey(ROADMAP_KEY),
        suggestedKey(CHECKLIST_KEY),
        `people|${BOB_KEY}`,
        `pages|${BUDGET_KEY}`,
        `pages|${TASKS_KEY}`,
        'dates|date:Today',
      ]);
      expect(document.querySelectorAll('[data-fresh="true"]')).toHaveLength(0);

      await pick(view, suggestedKey(ROADMAP_KEY));
      expect(mockAddMark).toHaveBeenCalledWith(
        view.editor,
        expect.objectContaining({ value: expect.objectContaining({ type: MentionType.PageRef, page_id: uuid(10) }) })
      );
      // The server listed it, so it is the server's pick, reported to selection memory.
      expect(feedbackBodies()).toEqual([{ target_kind: 'page', target_id: uuid(10), position: 2, query_len: 0 }]);
      await endSession();
      expect(mockReport.mock.calls[0]?.[1] as MentionPickerSession).toMatchObject({
        outcome: 'selected',
        selected_rank: 2,
        selected_section: 'suggested',
        selected_source: 'server',
      });
    });

    it('leaves a partial answer cacheable when it took every page, so an opening soon after asks nothing', async () => {
      // Shed paths or a degraded People annotation make the answer partial, and Cloud leaves out a
      // Pages section whose last page moved into Suggested (MEN-X-10).
      const search = createSearch(() => ({
        partial: true,
        sections: [
          section(MentionSearchSectionKind.Suggested, [ROADMAP]),
          section(MentionSearchSectionKind.People, [BOB]),
          section(MentionSearchSectionKind.Dates, [TODAY]),
        ],
      }));

      await openPanel(search);
      cleanup();
      await advance(1_000);

      renderPanel();
      await advance(0);
      // Within the cache's fresh window: the answer at once, no skeleton.
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(optionKeys()).toEqual([suggestedKey(ROADMAP_KEY), `people|${BOB_KEY}`, 'dates|date:Today']);
      await advance(100);
      expect(search).toHaveBeenCalledTimes(1);
    });
  });

  describe('reasons', () => {
    const now = () => Date.now();
    const explained = (): MentionSearchResponse => ({
      sections: [
        section(MentionSearchSectionKind.People, [
          personItem(ADA_ENTRY, { reason: { signal: 'participant', at: now() - MINUTE } }),
          personItem(BOB_ENTRY, { reason: { signal: 'mentioned', at: now() - MINUTE } }),
        ]),
        section(MentionSearchSectionKind.Pages, [
          page(uuid(10), 'Roadmap', { reason: { signal: 'viewed', at: now() - 5 * MINUTE } }),
          page(uuid(11), 'Budget', { reason: { signal: 'telepathy', at: now() - MINUTE, matched: 'psychic', tier: 9 } }),
          page(uuid(12), 'Notes', { reason: { signal: 'interaction', at: now() - MINUTE } }),
          page(uuid(13), 'Plans', { reason: {} }),
        ]),
      ],
    });

    it('are asked for while the item details show them, and a code the picker does not know shows nothing', async () => {
      advertise(['reasons_v1']);
      localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'true');

      const search = createSearch(() => explained());

      await openPanel(search);
      expect(sentFeatures(search)).toEqual([['bare', ['reasons_v1']]]);
      expect(chipOf(option(`people|${ADA_KEY}`))).toBe('On this page');
      expect(chipOf(option(`pages|${ROADMAP_KEY}`))).toBe('Opened 5 min ago');
      [`people|${BOB_KEY}`, `pages|${BUDGET_KEY}`, `pages|page:${uuid(12)}`, `pages|page:${uuid(13)}`].forEach((key) =>
        expect(chipOf(option(key))).toBeNull()
      );
      expect(document.body.textContent).not.toMatch(/telepathy|psychic|interaction|mentioned/i);
    });

    it('are neither asked for nor shown with the item details off', async () => {
      advertise(['reasons_v1']);

      const search = createSearch(() => explained());

      await openPanel(search);
      expect(sentFeatures(search)).toEqual([['bare', undefined]]);
      expect(document.querySelector('[data-testid="mention-reason-chip"]')).toBeNull();
      expect(option(`pages|${ROADMAP_KEY}`).textContent).toBe('Roadmap');
      expect(option(`pages|${BUDGET_KEY}`).textContent).toBe('Budget');
    });
  });

  describe('pick feedback', () => {
    beforeEach(() => advertise(['selection_memory_v1']));

    it('reports an inserted item once, without holding the insertion', async () => {
      // The report never settles: the pick must not wait for it.
      mockPost.mockImplementation(() => new Promise(() => undefined));

      const view = await openPanel(createSearch(answering(RELEASED_BARE)), 'ro');

      await pick(view, `pages|${ROADMAP_KEY}`);
      expect(mockAddMark).toHaveBeenCalledTimes(1);
      expect(mockPanelContext.closePanel).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        FEEDBACK_URL,
        { target_kind: 'page', target_id: uuid(10), position: 1, query_len: 2 },
        { timeout: 3_000, skipTransportRetry: true, skipAuthRefresh: true }
      );
    });

    it('ignores a 404: the pick is inserted, nothing is logged, and the tab reports no more picks', async () => {
      const consoleError = jest.spyOn(console, 'error');

      mockPost.mockRejectedValue(httpError(404));

      const search = createSearch(answering(RELEASED_BARE));
      let view = await openPanel(search, 'ro');

      await pick(view, `pages|${ROADMAP_KEY}`);
      await advance(0);
      expect(mockAddMark).toHaveBeenCalledTimes(1);
      expect(feedbackBodies()).toHaveLength(1);
      expect(consoleError).not.toHaveBeenCalled();

      cleanup();
      view = await openPanel(search);
      await pick(view, `people|${BOB_KEY}`);
      await advance(0);
      expect(mockAddMark).toHaveBeenCalledTimes(2);
      expect(feedbackBodies()).toHaveLength(1);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('sends neither the opt-in nor a report when the user declined selection memory', async () => {
      localStorage.setItem(MENTION_SELECTION_MEMORY_OVERRIDE_KEY, 'false');

      const search = createSearch(answering(RELEASED_BARE));
      let view = await openPanel(search, 'ro');

      expect(sentFeatures(search)).toEqual([
        ['bare', undefined],
        ['primary', undefined],
        ['rows', undefined],
      ]);
      await pick(view, `pages|${ROADMAP_KEY}`);
      cleanup();
      view = await openPanel(search);
      await pick(view, `people|${BOB_KEY}`);
      await advance(0);
      expect(mockAddMark).toHaveBeenCalledTimes(2);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('reports a person by person id, and nothing for a date or a page only this tab listed', async () => {
      localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
      recordMentionViewCreated(WORKSPACE, { viewId: uuid(40), name: 'Roadster plan', layout: ViewLayout.Document });

      const search = createSearch(answering(RELEASED_BARE));
      let view = await openPanel(search);

      await pick(view, 'dates|date:Today');
      cleanup();
      view = await openPanel(search, 'ro');
      expect(optionKeys()).toContain(`pages|page:${uuid(40)}`);
      await pick(view, `pages|page:${uuid(40)}`);
      cleanup();
      view = await openPanel(search);
      await pick(view, `people|${BOB_KEY}`);

      expect(mockAddMark).toHaveBeenCalledTimes(3);
      expect(feedbackBodies()).toEqual([
        { target_kind: 'person', target_id: BOB_ENTRY.person_id, position: 2, query_len: 0 },
      ]);
    });
  });
});
