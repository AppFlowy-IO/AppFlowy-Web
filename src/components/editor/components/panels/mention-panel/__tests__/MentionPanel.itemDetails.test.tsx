import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

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
  ViewIconType,
  ViewLayout,
} from '@/application/types';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';

import { MENTION_ITEM_DETAILS_OVERRIDE_KEY } from '../mentionItemDetails';
import {
  clearMentionLocalIndex,
  recordMentionRoster,
  recordMentionViewCreated,
  recordMentionViewOpened,
  setMentionIndexSources,
} from '../mentionLocalIndex';
import { clearMentionSessionPersonPicks } from '../mentionLocalLane';
import { MentionPanel } from '../MentionPanel';
import { clearMentionSearchCacheForTests } from '../mentionSearchCache';
import { MENTION_TYPEAHEAD_V2_OVERRIDE_KEY } from '../mentionTypeaheadFlag';

const mockAddMark = jest.fn();
/** Every `src` the picker handed an avatar image, as it was passed. */
const mockAvatarSources: unknown[] = [];
/** The roster endpoint (`mentionable-person`); it fails unless a test answers it. */
const mockGetMentionableUsers = jest.fn<Promise<MentionablePerson[]>, [string]>();
/** The member profiles the roster cache finds in IndexedDB, by workspace. */
const mockDiskRosters = new Map<string, MentionablePerson[]>();
/** Every workspace the picker asked the roster cache for, in order. */
const mockRosterLoads: (string | undefined)[] = [];
const WORKSPACE = 'workspace';
const MINUTE = 60_000;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const ME = uuid(99);
const mockCurrentUser = { uid: '7', uuid: ME, email: 'me@appflowy.io', name: 'Me', avatar: null };
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

// The English copy itself, so a missing key or a wrong placeholder shows.
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
jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { getMentionableUsers: (workspaceId: string) => mockGetMentionableUsers(workspaceId) },
}));
// The roster cache's table, holding `mockDiskRosters`.
jest.mock('@/application/db', () => ({
  db: {
    workspace_member_profiles: {
      where: () => ({
        equals: (workspaceId: string) => ({
          toArray: () => Promise.resolve(mockDiskRosters.get(workspaceId) ?? []),
          delete: () => Promise.resolve(0),
        }),
      }),
      bulkPut: () => Promise.resolve(),
    },
  },
}));
// The real roster cache, counting what the picker asks it for.
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => {
  const actual = jest.requireActual<typeof import('@/components/database/components/cell/person/useMentionableUsers')>(
    '@/components/database/components/cell/person/useMentionableUsers'
  );

  return {
    ...actual,
    loadMentionableUsers: (workspaceId: string | undefined) => {
      mockRosterLoads.push(workspaceId);
      return actual.loadMentionableUsers(workspaceId);
    },
  };
});
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
// Radix draws an avatar's image only once it loads, which never happens here: record what the
// picker passes as its source instead, and draw it as a plain image.
jest.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: ReactNode }) => <span data-testid='avatar'>{children}</span>,
  AvatarImage: ({ src, alt }: { src?: unknown; alt?: string }) => {
    mockAvatarSources.push(src);
    return src ? <img data-testid='avatar-image' src={src as string} alt={alt} /> : null;
  },
  AvatarFallback: ({ children }: { children: ReactNode }) => <span data-testid='avatar-fallback'>{children}</span>,
}));

type Lane = 'bare' | 'primary' | 'rows';

function laneOf(request: MentionSearchRequest): Lane {
  if (!request.query?.trim()) return 'bare';
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow ? 'rows' : 'primary';
}

/** Answers the bare and primary requests after `delayMs` with `answer()`, and the rows request with nothing. */
function createSearch(answer: () => MentionSearchResponse, delayMs = 50) {
  return jest.fn(
    (request: MentionSearchRequest, options?: MentionSearchOptions) =>
      new Promise<MentionSearchResponse>((resolve, reject) => {
        const timer = setTimeout(() => resolve(laneOf(request) === 'rows' ? { sections: [] } : answer()), delayMs);

        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject({ code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' });
        });
      })
  );
}

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ok' };
}

function answerOf(...sections: MentionSearchSection[]): MentionSearchResponse {
  return { sections };
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

function database(databaseId: string, viewId: string, title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Database,
    object_id: databaseId,
    title,
    subtitle: 'Database',
    database_id: databaseId,
    database_view_id: viewId,
    mention: { type: MentionTargetKind.Database, database_id: databaseId, database_view_id: viewId },
  };
}

function rosterEntry(n: number, name: string, avatar: string | null = null): MentionablePerson {
  return {
    uid: String(100 + n),
    avatar_url: avatar,
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

function outlineView(id: string, name: string, fields: Partial<View> = {}): View {
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

/**
 * The awareness of a page with these people on it: Web writes a person id (`user_uuid`), Desktop
 * only its uid (`metadata.id`).
 */
function awarenessOf(present: ({ name: string; uuid: string } | { name: string; uid: string })[]) {
  const states = new Map(
    present.map((person, index) => [
      index + 1,
      {
        user: { uid: index + 1, device_id: `${person.name}-device` },
        metadata: JSON.stringify(
          'uuid' in person
            ? { user_name: person.name, user_uuid: person.uuid }
            : { user_name: person.name, id: person.uid }
        ),
      },
    ])
  );

  return { getStates: () => states, on: jest.fn(), off: jest.fn() };
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

/** Opens the picker on `query` (the bare `@` when empty) and lets its answers arrive. */
async function openPanel(search: ReturnType<typeof createSearch>, query = '') {
  mockEditorContext.searchMentions = search;
  mockPanelContext.searchText = '';

  const view = renderPanel();

  await advance(100);
  if (query) {
    mockPanelContext.searchText = query;
    view.rerender();
  }

  await advance(1_000);
  return view;
}

/** The result row titled `title`, by the title's own element. */
function row(title: string): HTMLElement {
  const option = Array.from(document.querySelectorAll<HTMLElement>('[data-option-kind]')).find((element) =>
    Array.from(element.querySelectorAll('span')).some((span) => span.textContent === title && span.children.length === 0)
  );

  if (!option) throw new Error(`No result titled ${title}`);
  return option;
}

function rowsTitled(title: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-option-kind]')).filter((element) =>
    Array.from(element.querySelectorAll('span')).some((span) => span.textContent === title && span.children.length === 0)
  );
}

function breadcrumbOf(option: HTMLElement): string | null {
  return option.querySelector('[data-testid="mention-breadcrumb"]')?.textContent ?? null;
}

function chipOf(option: HTMLElement): string | null {
  return option.querySelector('[data-testid="mention-reason-chip"]')?.textContent ?? null;
}

/** Every image source on screen is a string an image loads from, and so is every avatar's. */
function expectOnlyStringImageSources() {
  document.querySelectorAll('img').forEach((image) => {
    expect(image.getAttribute('src')).toMatch(/^(https?:|data:|blob:|\/)/);
  });
  mockAvatarSources.forEach((src) => {
    expect(src === undefined || typeof src === 'string').toBe(true);
  });
}

const ICON_OBJECT = { ty: 'url', value: 'https://cdn.appflowy.io/icon.png' };

describe('MentionPanel item details (MEN-WEB-13)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAvatarSources.length = 0;
    mockRosterLoads.length = 0;
    mockDiskRosters.clear();
    // Offline unless a test answers: a roster a test records stays the one the picker reads.
    mockGetMentionableUsers.mockReset().mockRejectedValue(new Error('offline'));
    mockPanelContext.activePanel = PanelType.Mention;
    mockPanelContext.activeTrigger = '@';
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
    clearMentionSearchCacheForTests();
    clearMentionLocalIndex();
    clearMentionSessionPersonPicks();
    localStorage.clear();
    localStorage.setItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY, 'true');
    mockPanelContext.searchText = '';
    Object.keys(mockEditorContext).forEach((key) => delete mockEditorContext[key]);
    mockEditorContext.workspaceId = WORKSPACE;
    Element.prototype.scrollIntoView = jest.fn();
    setMentionIndexSources(WORKSPACE, { outline: [] });
  });

  afterEach(() => {
    cleanup();
    clearMentionLocalIndex();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows what it showed before while the switch is off, and survives an icon object', async () => {
    localStorage.removeItem(MENTION_ITEM_DETAILS_OVERRIDE_KEY);

    const ada = rosterEntry(1, 'Ada', 'https://cdn.appflowy.io/ada.png');

    recordMentionRoster(WORKSPACE, [ada]);
    setMentionIndexSources(WORKSPACE, { outline: [outlineView('notes', 'Meeting notes')] });
    recordMentionViewOpened(WORKSPACE, 'notes', Date.now() - 3 * MINUTE);

    await openPanel(
      createSearch(() =>
        answerOf(
          section(MentionSearchSectionKind.People, [personItem(ada, { icon: ICON_OBJECT })]),
          section(MentionSearchSectionKind.Pages, [
            page('notes', 'Meeting notes', {
              icon: ICON_OBJECT,
              path: [{ view_id: 'eng', title: 'Engineering' }],
              path_status: 'complete',
              subtitle: 'Engineering',
              reason: { signal: 'viewed', at: Date.now() - MINUTE },
            }),
          ])
        )
      )
    );

    // The title and the address, after the avatar's initials; the page's title alone.
    expect(row('Ada').textContent).toBe('AdaAdaada@appflowy.io');
    expect(row('Meeting notes').textContent).toBe('Meeting notes');
    expect(document.querySelector('[data-testid="mention-breadcrumb"]')).toBeNull();
    expect(document.querySelector('[data-testid="mention-reason-chip"]')).toBeNull();
    expect(document.querySelector('[data-testid="mention-view-icon"]')).toBeNull();
    // The person shows initials: the object never became the image, and the roster is not read.
    expect(screen.queryByTestId('avatar-image')).toBeNull();
    expect(mockAvatarSources).toContain(undefined);
    expectOnlyStringImageSources();
    // Nor loaded: the picker asks for nothing more than before.
    expect(mockRosterLoads).toEqual([]);
    expect(mockGetMentionableUsers).not.toHaveBeenCalled();
  });

  describe('breadcrumbs', () => {
    it("tell two 'Meeting notes' pages apart by their complete paths", async () => {
      await openPanel(
        createSearch(() =>
          answerOf(
            section(MentionSearchSectionKind.Pages, [
              page('a', 'Meeting notes', {
                path: [
                  { view_id: 'eng', title: 'Engineering' },
                  { view_id: 'specs', title: 'Specs' },
                ],
                path_status: 'complete',
                subtitle: 'Engineering / Specs',
              }),
              page('b', 'Meeting notes', {
                path: [{ view_id: 'mkt', title: 'Marketing' }],
                path_status: 'complete',
                subtitle: 'Marketing',
              }),
            ])
          )
        ),
        'meeting'
      );

      const [first, second] = rowsTitled('Meeting notes');

      expect(breadcrumbOf(first)).toBe('Engineering / Specs');
      expect(breadcrumbOf(second)).toBe('Marketing');
      // The full path is the tooltip of a breadcrumb the row cuts short.
      expect(first.querySelector('[data-testid="mention-breadcrumb"]')?.getAttribute('title')).toBe(
        'Engineering / Specs'
      );
    });

    it('are left out for an omitted or missing path, and a database shows no server subtitle', async () => {
      const path = [{ view_id: 'eng', title: 'Engineering' }];

      await openPanel(
        createSearch(() =>
          answerOf(
            section(MentionSearchSectionKind.Pages, [
              page('shed', 'Shed for load', { path, path_status: 'omitted_due_to_load' }),
              page('lost', 'Unresolved', { path, path_status: 'omitted_unavailable' }),
              page('old', 'Older server', { subtitle: 'Engineering' }),
            ]),
            section(MentionSearchSectionKind.Databases, [database('db', 'grid', 'Tasks')])
          )
        )
      );

      ['Shed for load', 'Unresolved', 'Older server', 'Tasks'].forEach((title) => {
        expect(breadcrumbOf(row(title))).toBeNull();
        expect(row(title).textContent).toBe(title);
      });
    });
  });

  describe('avatars and icons', () => {
    it("show a person's roster avatar by person id", async () => {
      const ada = rosterEntry(1, 'Ada', 'https://cdn.appflowy.io/ada.png');

      recordMentionRoster(WORKSPACE, [ada]);
      await openPanel(createSearch(() => answerOf(section(MentionSearchSectionKind.People, [personItem(ada)]))));

      expect(within(row('Ada')).getByTestId('avatar-image').getAttribute('src')).toBe('https://cdn.appflowy.io/ada.png');
      expectOnlyStringImageSources();
    });

    it('load the roster once per opening, for its avatars and Desktop collaborators', async () => {
      const workspace = 'workspace-roster-api';
      const ada = rosterEntry(1, 'Ada', 'https://cdn.appflowy.io/ada.png');
      const bob = rosterEntry(2, 'Bob');
      let answerRoster: (people: MentionablePerson[]) => void = () => undefined;

      // Nothing else in the tab loaded the roster, and nothing is on disk.
      mockGetMentionableUsers.mockReturnValueOnce(
        new Promise((resolve) => {
          answerRoster = resolve;
        })
      );
      mockEditorContext.workspaceId = workspace;
      setMentionIndexSources(workspace, { outline: [] });
      // Bob is on the page from Desktop, whose awareness names him by uid only.
      mockEditorContext.awareness = awarenessOf([{ name: 'Bob', uid: String(bob.uid) }]);

      const view = await openPanel(
        createSearch(() => answerOf(section(MentionSearchSectionKind.People, [personItem(ada), personItem(bob)])))
      );

      // Until it arrives: initials, and no one known to be on the page.
      expect(within(row('Ada')).queryByTestId('avatar-image')).toBeNull();
      expect(chipOf(row('Bob'))).toBeNull();

      for (const query of ['a', 'ad']) {
        mockPanelContext.searchText = query;
        view.rerender();
        await advance(1_000);
      }

      await act(async () => {
        answerRoster([ada, bob]);
      });
      await advance(10);

      expect(within(row('Ada')).getByTestId('avatar-image').getAttribute('src')).toBe('https://cdn.appflowy.io/ada.png');
      expect(chipOf(row('Bob'))).toBe('On this page');
      // One load for the opening, whatever was typed, and one request.
      expect(mockRosterLoads).toEqual([workspace]);
      expect(mockGetMentionableUsers.mock.calls).toEqual([[workspace]]);
      expectOnlyStringImageSources();

      // The next opening loads it again, and the roster cache answers without a request.
      mockPanelContext.isPanelOpen = () => false;
      view.rerender();
      await advance(10);
      mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
      view.rerender();
      await advance(1_000);

      expect(within(row('Ada')).getByTestId('avatar-image').getAttribute('src')).toBe('https://cdn.appflowy.io/ada.png');
      expect(mockRosterLoads).toEqual([workspace, workspace]);
      expect(mockGetMentionableUsers).toHaveBeenCalledTimes(1);
    });

    it('read a fresh roster from the disk cache without a request', async () => {
      const workspace = 'workspace-roster-disk';
      const ada = rosterEntry(1, 'Ada', 'https://cdn.appflowy.io/ada.png');

      mockDiskRosters.set(workspace, [ada]);
      localStorage.setItem(`af_mentionable_users_synced_at:${workspace}`, String(Date.now()));
      mockEditorContext.workspaceId = workspace;
      setMentionIndexSources(workspace, { outline: [] });

      await openPanel(createSearch(() => answerOf(section(MentionSearchSectionKind.People, [personItem(ada)]))));

      expect(within(row('Ada')).getByTestId('avatar-image').getAttribute('src')).toBe('https://cdn.appflowy.io/ada.png');
      expect(mockRosterLoads).toEqual([workspace]);
      expect(mockGetMentionableUsers).not.toHaveBeenCalled();
    });

    it('load no roster for a page reference picker, which lists no people', async () => {
      mockPanelContext.activePanel = PanelType.PageReference;
      mockPanelContext.activeTrigger = '[[';
      mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.PageReference;

      await openPanel(
        createSearch(() => answerOf(section(MentionSearchSectionKind.Pages, [page('notes', 'Meeting notes')])))
      );

      expect(row('Meeting notes')).toBeTruthy();
      expect(mockRosterLoads).toEqual([]);
      expect(mockGetMentionableUsers).not.toHaveBeenCalled();
    });

    it('never pass an icon object to an image, and never save one into the mention', async () => {
      const bob = rosterEntry(2, 'Bob');

      recordMentionRoster(WORKSPACE, [bob]);
      setMentionIndexSources(WORKSPACE, {
        outline: [
          outlineView('logo', 'Logo page', {
            icon: { ty: ViewIconType.URL, value: 'https://cdn.appflowy.io/logo.png' },
          }),
        ],
      });

      const view = await openPanel(
        createSearch(() =>
          answerOf(
            section(MentionSearchSectionKind.People, [personItem(bob, { icon: ICON_OBJECT })]),
            section(MentionSearchSectionKind.Pages, [
              page('plain', 'Plain page', { icon: ICON_OBJECT }),
              page('logo', 'Logo page', { icon: ICON_OBJECT }),
            ])
          )
        )
      );

      // Bob has no roster avatar: initials, never the object.
      expect(within(row('Bob')).queryByTestId('avatar-image')).toBeNull();
      expect(within(row('Bob')).getByTestId('avatar-fallback').textContent).toBe('Bob');
      // The page the index knows shows its own image icon, resolved from the outline's string.
      expect(await within(row('Logo page')).findByTestId('page-icon-image')).toBeTruthy();
      expect(within(row('Plain page')).queryByTestId('mention-view-icon')).toBeNull();
      expectOnlyStringImageSources();

      await act(async () => {
        Transforms.select(view.editor, Editor.end(view.editor, []));
      });
      await act(async () => {
        fireEvent.click(row('Plain page'));
      });

      const [, mark] = mockAddMark.mock.calls[0] as [unknown, { value: { data?: Record<string, unknown> } }];

      expect(mark.value.data).toEqual({ title: 'Plain page', subtitle: undefined, icon: undefined });
    });

    it("draw a page's and a database's icon from the local index", async () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [
          outlineView('notes', 'Notes', { icon: { ty: ViewIconType.Emoji, value: '📝' } }),
          outlineView('list', 'Reading list', {
            layout: ViewLayout.List,
            extra: { is_space: false, database_id: 'db' },
          }),
        ],
      });

      await openPanel(
        createSearch(() =>
          answerOf(
            section(MentionSearchSectionKind.Pages, [page('notes', 'Notes'), page('unknown', 'Not in the outline')]),
            section(MentionSearchSectionKind.Databases, [database('db', 'list', 'Reading list')])
          )
        )
      );

      expect(within(row('Notes')).getByTestId('mention-view-icon').textContent).toBe('📝');
      expect(within(row('Reading list')).getByTestId('list-view-icon')).toBeTruthy();
      expect(within(row('Not in the outline')).queryByTestId('mention-view-icon')).toBeNull();
    });
  });

  describe('reason chips', () => {
    it('say when this tab opened or created an item', async () => {
      setMentionIndexSources(WORKSPACE, {
        outline: [outlineView('roadmap', 'Roadmap'), outlineView('budget', 'Budget')],
      });
      recordMentionViewOpened(WORKSPACE, 'roadmap', Date.now() - 3 * MINUTE);
      recordMentionViewCreated(WORKSPACE, { viewId: 'draft', name: 'Draft', layout: ViewLayout.Document });

      await openPanel(
        createSearch(() =>
          answerOf(
            section(MentionSearchSectionKind.Pages, [
              page('roadmap', 'Roadmap'),
              page('draft', 'Draft'),
              page('budget', 'Budget'),
            ])
          )
        )
      );

      expect(chipOf(row('Roadmap'))).toBe('Opened 3 min ago');
      expect(chipOf(row('Draft'))).toBe('Created just now');
      expect(chipOf(row('Budget'))).toBeNull();
    });

    it('say a collaborator is on the page, and leave out the page being edited', async () => {
      const ada = rosterEntry(1, 'Ada');
      const bob = rosterEntry(2, 'Bob');

      recordMentionRoster(WORKSPACE, [ada, bob, rosterEntry(99, 'Me')]);
      mockEditorContext.viewId = 'doc';
      mockEditorContext.awareness = awarenessOf([
        { name: 'Ada', uuid: ada.person_id },
        { name: 'Me', uuid: ME },
      ]);
      setMentionIndexSources(WORKSPACE, { outline: [outlineView('doc', 'This page')] });
      recordMentionViewOpened(WORKSPACE, 'doc');

      await openPanel(
        createSearch(() =>
          answerOf(
            section(MentionSearchSectionKind.People, [personItem(ada), personItem(bob)]),
            section(MentionSearchSectionKind.Pages, [page('doc', 'This page', { reason: { signal: 'current' } })])
          )
        )
      );

      expect(chipOf(row('Ada'))).toBe('On this page');
      expect(chipOf(row('Bob'))).toBeNull();
      expect(chipOf(row('This page'))).toBeNull();
    });

    it("show the server's viewed, created and participant reasons, and nothing for the others", async () => {
      const ada = rosterEntry(1, 'Ada');
      const bob = rosterEntry(2, 'Bob');
      const now = Date.now();

      await openPanel(
        createSearch(() =>
          answerOf(
            section(MentionSearchSectionKind.People, [
              personItem(ada, { reason: { signal: 'participant', at: now - MINUTE } }),
              personItem(bob, { reason: { signal: 'interaction', at: now - MINUTE } }),
            ]),
            // Four, so none hides behind "N more".
            section(MentionSearchSectionKind.Pages, [
              page('viewed', 'Viewed', {
                reason: { signal: 'viewed', at: now - 5 * MINUTE, matched: 'prefix', tier: 1 },
              }),
              page('created', 'Created', { reason: { signal: 'created', at: now - 2 * 60 * MINUTE } }),
              page('changed', 'Changed', { reason: { signal: 'changed', at: now - MINUTE } }),
              page('later', 'Later signal', { reason: { signal: 'picked', at: now - MINUTE } }),
            ])
          )
        ),
        'e'
      );

      expect(chipOf(row('Ada'))).toBe('On this page');
      expect(chipOf(row('Bob'))).toBeNull();
      expect(chipOf(row('Viewed'))).toBe('Opened 5 min ago');
      expect(chipOf(row('Created'))).toBe('Created 2 hours ago');
      ['Changed', 'Later signal'].forEach((title) => expect(chipOf(row(title))).toBeNull());
      expect(document.body.textContent).not.toMatch(/Edited/i);
    });

    it("mark a page only this tab holds, with the picker's v2 on", async () => {
      localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
      recordMentionViewCreated(WORKSPACE, { viewId: 'zebra', name: 'Zebra plan', layout: ViewLayout.Document });

      await openPanel(
        createSearch(() => answerOf()),
        'zeb'
      );

      const zebra = row('Zebra plan');

      expect(zebra.getAttribute('data-fresh')).toBe('true');
      expect(chipOf(zebra)).toBe('Created just now');
    });
  });
});
