/**
 * MEN-WEB-12: the @ picker's section titles come from the translations, and its sections switch
 * (off by default) lays every kind out in a section of its own, collapses each people and object
 * section to four results with "N more", and offers to create a page for a typed query.
 *
 * The panel renders with a real i18next instance on `en.json`, set up as the app sets it up
 * (`src/i18n/config.ts`: values escaped), so the strings on screen are the shipped English ones.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import en from '@/@types/translations/en.json';
import {
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

import { MentionPanel } from '../MentionPanel';
import { clearMentionSearchCacheForTests } from '../mentionSearchCache';
import { MENTION_SECTIONS_V2_OVERRIDE_KEY, MENTION_TYPEAHEAD_V2_OVERRIDE_KEY } from '../mentionTypeaheadFlag';

const mockAddMark = jest.fn();

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

// English, as the app loads it. A second language translates only the section titles; every other
// string falls back to English.
const english = createInstance();
const german = createInstance();

type Lane = 'bare' | 'primary' | 'rows';

function laneOf(request: MentionSearchRequest): Lane {
  if (!request.query?.trim()) return 'bare';
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow ? 'rows' : 'primary';
}

function person(name: string): MentionSearchResultItem {
  const id = name.toLowerCase();

  return {
    kind: MentionTargetKind.Person,
    object_id: id,
    title: name,
    subtitle: `${id}@example.com`,
    mention: { type: MentionTargetKind.Person, person_id: id, person_name: name, page_id: 'page' },
  };
}

function page(title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Page,
    object_id: title,
    title,
    mention: { type: MentionTargetKind.Page, page_id: title },
  };
}

// As Search sends it: the database id is the object id, and the view travels beside it.
function database(title: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Database,
    object_id: 'database-1',
    title,
    database_id: 'database-1',
    database_view_id: 'grid-1',
    mention: { type: MentionTargetKind.Database, database_id: 'database-1', database_view_id: 'grid-1' },
  };
}

// Titled as no server titles a section: the picker must never show these titles.
function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: `Server ${kind}`, items, has_more: false, status: 'ok' };
}

const PEOPLE = ['Ada', 'Bea', 'Cal', 'Dee', 'Eve', 'Fay'].map(person);
const PAGES = ['Road 1', 'Road 2', 'Road 3', 'Road 4', 'Road 5'].map(page);
// A database the user viewed a minute ago, which the server lists after five pages.
const ROAD_DATABASE = database('Road database');
// What the primary request for `road` gets, in the order servers send; the rows request finds none.
const ROAD_ANSWER: MentionSearchResponse = {
  sections: [
    section(MentionSearchSectionKind.People, PEOPLE),
    section(MentionSearchSectionKind.Pages, PAGES),
    section(MentionSearchSectionKind.Databases, [ROAD_DATABASE]),
  ],
};
const BARE_ANSWER: MentionSearchResponse = {
  sections: [section(MentionSearchSectionKind.Pages, [page('Recent page')])],
};
const EMPTY: MentionSearchResponse = { sections: [] };

function createSearch(answer: (lane: Lane, query: string) => MentionSearchResponse, delayMs = 50) {
  return jest.fn(
    (request: MentionSearchRequest, options?: MentionSearchOptions) =>
      new Promise<MentionSearchResponse>((resolve, reject) => {
        const timer = setTimeout(() => resolve(answer(laneOf(request), request.query ?? '')), delayMs);

        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject({ code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' });
          },
          { once: true }
        );
      })
  );
}

function answerRoad(lane: Lane) {
  if (lane === 'bare') return BARE_ANSWER;
  return lane === 'primary' ? ROAD_ANSWER : EMPTY;
}

function renderPanel({ i18n = english, canCreatePages }: { i18n?: typeof english; canCreatePages?: boolean } = {}) {
  const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });
  const tree = () => (
    <I18nextProvider i18n={i18n}>
      <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@road' }] }]}>
        <Editable data-testid='editor' />
        <MentionPanel notifyOnInsert={false} canCreatePages={canCreatePages} />
      </Slate>
    </I18nextProvider>
  );
  const view = render(tree());

  return { editor, rerender: () => view.rerender(tree()) };
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** Opens the panel on the bare `@`, then types `query` and waits for its answer. */
async function openAndType(query: string, options: Parameters<typeof renderPanel>[0] = {}) {
  mockPanelContext.searchText = '';

  const view = renderPanel(options);

  await advance(100);
  mockPanelContext.searchText = query;
  view.rerender();
  await advance(1_000);
  return view;
}

function sectionKinds() {
  return Array.from(document.querySelectorAll('[data-section-kind]')).map((shown) =>
    shown.getAttribute('data-section-kind')
  );
}

function headings() {
  return Array.from(document.querySelectorAll('[data-section-kind]')).map(
    (shown) => shown.querySelector(':scope > div > span')?.textContent
  );
}

function resultsIn(kind: MentionSearchSectionKind) {
  return Array.from(document.querySelectorAll(`[data-section-kind="${kind}"] [data-option-kind]`));
}

function titlesIn(kind: MentionSearchSectionKind) {
  return resultsIn(kind).map((option) => option.textContent);
}

function moreRowIn(kind: MentionSearchSectionKind) {
  return document.querySelector<HTMLElement>(`[data-section-kind="${kind}"] [data-option-key="${kind}|more"]`);
}

function optionKeys() {
  return Array.from(document.querySelectorAll('[data-option-key]')).map((option) =>
    option.getAttribute('data-option-key')
  );
}

function createOptions() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-option-key^="createPage:"]'));
}

function highlighted() {
  return Array.from(document.querySelectorAll('[data-option-index][data-selected="true"]')).map((option) =>
    option.getAttribute('data-option-key')
  );
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

describe('MentionPanel sections (MEN-WEB-12)', () => {
  beforeAll(async () => {
    await english.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } } });
    await german.init({
      lng: 'de',
      fallbackLng: 'en',
      resources: {
        en: { translation: en },
        de: {
          translation: { document: { mentionMenu: { people: 'Personen', pages: 'Seiten', databases: 'Datenbanken' } } },
        },
      },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    clearMentionSearchCacheForTests();
    localStorage.clear();
    mockPanelContext.activePanel = PanelType.Mention;
    mockPanelContext.isPanelOpen = (panel: PanelType) => panel === PanelType.Mention;
    mockPanelContext.searchText = '';
    mockEditorContext.searchMentions = createSearch(answerRoad);
    mockEditorContext.loadViews = undefined;
    mockEditorContext.addPage = undefined;
    mockEditorContext.viewId = undefined;
    mockEditorContext.openPageModal = undefined;
    Element.prototype.scrollIntoView = jest.fn();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('with the sections switch off, as by default', () => {
    it("titles sections in the user's language, never with the titles the server sent", async () => {
      await openAndType('road');

      expect(headings()).toEqual(['People', 'Pages']);
      expect(screen.queryByText(/^Server /)).toBeNull();
      cleanup();

      clearMentionSearchCacheForTests();
      await openAndType('road', { i18n: german });
      expect(headings()).toEqual(['Personen', 'Seiten']);
      // The strings the second language lacks fall back to English.
      expect(moreRowIn(MentionSearchSectionKind.Pages)?.textContent).toBe('2 more results...');
    });

    it('folds the database into Pages behind "N more", lists every person, and offers no page to create', async () => {
      mockEditorContext.addPage = jest.fn();
      mockEditorContext.viewId = 'current-page';
      await openAndType('road');

      expect(sectionKinds()).toEqual([MentionSearchSectionKind.People, MentionSearchSectionKind.Pages]);
      expect(resultsIn(MentionSearchSectionKind.People)).toHaveLength(6);
      expect(moreRowIn(MentionSearchSectionKind.People)).toBeNull();
      expect(titlesIn(MentionSearchSectionKind.Pages)).toEqual(['Road 1', 'Road 2', 'Road 3', 'Road 4']);
      expect(moreRowIn(MentionSearchSectionKind.Pages)?.textContent).toBe('2 more results...');
      expect(screen.queryByText('Road database')).toBeNull();
      expect(createOptions()).toHaveLength(0);

      act(() => {
        fireEvent.click(moreRowIn(MentionSearchSectionKind.Pages) as HTMLElement);
      });
      expect(titlesIn(MentionSearchSectionKind.Pages)).toEqual([...PAGES.map(({ title }) => title), 'Road database']);
    });

    it("keeps the local fallback's own titles and its create options, now translated", async () => {
      mockEditorContext.searchMentions = undefined;
      mockEditorContext.loadViews = jest.fn(async () => [
        { view_id: 'target', name: 'Target', layout: ViewLayout.Document } as View,
      ]);
      mockEditorContext.addPage = jest.fn();
      mockEditorContext.viewId = 'current-page';
      renderPanel();
      await advance(100);

      expect(headings()).toEqual(['Recent pages', 'Date']);
      expect(createOptions().map((option) => option.textContent)).toEqual([
        'Create new sub-page',
        'Create new page in...',
      ]);
    });
  });

  describe('with the sections switch on', () => {
    beforeEach(() => {
      localStorage.setItem(MENTION_SECTIONS_V2_OVERRIDE_KEY, 'true');
    });

    it('shows a database viewed a minute ago in its own section while Pages lists four pages and "1 more"', async () => {
      await openAndType('road');

      expect(sectionKinds()).toEqual([
        MentionSearchSectionKind.People,
        MentionSearchSectionKind.Pages,
        MentionSearchSectionKind.Databases,
      ]);
      expect(headings()).toEqual(['People', 'Pages', 'Databases']);
      expect(titlesIn(MentionSearchSectionKind.Databases)).toEqual(['Road database']);
      expect(titlesIn(MentionSearchSectionKind.Pages)).toEqual(['Road 1', 'Road 2', 'Road 3', 'Road 4']);
      expect(moreRowIn(MentionSearchSectionKind.Pages)?.textContent).toBe('1 more results...');
      expect(resultsIn(MentionSearchSectionKind.People)).toHaveLength(4);
      expect(moreRowIn(MentionSearchSectionKind.People)?.textContent).toBe('2 more results...');
    });

    it("titles the separate sections in the user's language too", async () => {
      await openAndType('road', { i18n: german });

      expect(headings()).toEqual(['Personen', 'Seiten', 'Datenbanken']);
    });

    it('expands only the section whose "N more" was chosen, and hands the highlight to what it reveals', async () => {
      const view = await openAndType('road');

      act(() => {
        fireEvent.click(moreRowIn(MentionSearchSectionKind.People) as HTMLElement);
      });
      expect(resultsIn(MentionSearchSectionKind.People)).toHaveLength(6);
      expect(moreRowIn(MentionSearchSectionKind.People)).toBeNull();
      expect(titlesIn(MentionSearchSectionKind.Pages)).toHaveLength(4);
      expect(moreRowIn(MentionSearchSectionKind.Pages)).not.toBeNull();

      // From no highlight, ArrowUp wraps to the database, the last option, then to Pages' "1 more".
      await placeCaretAtEnd(view.editor);
      await pressKey('ArrowUp');
      await pressKey('ArrowUp');
      expect(highlighted()).toEqual([`${MentionSearchSectionKind.Pages}|more`]);
      await pressKey('Enter');
      expect(titlesIn(MentionSearchSectionKind.Pages)).toEqual(PAGES.map(({ title }) => title));
      expect(highlighted()).toEqual(['pages|page:Road 5']);
      expect(mockAddMark).not.toHaveBeenCalled();

      // A keystroke that keeps the search (a trailing space) keeps what is expanded; the next query
      // collapses every section again.
      mockPanelContext.searchText = 'road ';
      view.rerender();
      await advance(1_000);
      expect(resultsIn(MentionSearchSectionKind.People)).toHaveLength(6);
      expect(titlesIn(MentionSearchSectionKind.Pages)).toHaveLength(5);
      mockPanelContext.searchText = 'roads';
      view.rerender();
      await advance(1_000);
      expect(resultsIn(MentionSearchSectionKind.People)).toHaveLength(4);
      expect(titlesIn(MentionSearchSectionKind.Pages)).toHaveLength(4);
    });

    it('offers to create a page after the results of a typed query, and Enter creates it with the typed name', async () => {
      const addPage = jest.fn(async () => ({ view_id: 'new-page' }));

      mockEditorContext.addPage = addPage;
      mockEditorContext.viewId = 'current-page';
      mockPanelContext.searchText = '';

      const view = renderPanel();

      await advance(100);
      // A bare `@` offers none.
      expect(titlesIn(MentionSearchSectionKind.Pages)).toEqual(['Recent page']);
      expect(createOptions()).toHaveLength(0);

      mockPanelContext.searchText = 'road';
      view.rerender();
      await advance(1_000);

      const keys = optionKeys();

      expect(keys.slice(-2)).toEqual(['createPage:childPage', 'createPage:pageReference']);
      expect(keys.indexOf('databases|database:database-1:grid-1')).toBe(keys.length - 3);
      expect(createOptions().map((option) => option.textContent)).toEqual([
        'Create "road" sub-page',
        'Create "road" page in...',
      ]);

      await placeCaretAtEnd(view.editor);
      await pressKey('ArrowUp');
      await pressKey('ArrowUp');
      expect(highlighted()).toEqual(['createPage:childPage']);
      await pressKey('Enter');
      await advance(0);
      expect(addPage).toHaveBeenCalledWith('current-page', { name: 'road', layout: ViewLayout.Document });
      expect(mockAddMark).toHaveBeenCalledWith(
        view.editor,
        expect.objectContaining({ value: { page_id: 'new-page', type: MentionType.childPage } })
      );
    });

    it('shows the typed name as typed in the create labels, on its own', async () => {
      mockEditorContext.addPage = jest.fn();
      mockEditorContext.viewId = 'current-page';
      await openAndType('R&D <plan>');

      // i18next escapes interpolated values by default, which would show `R&amp;D &lt;plan&gt;`.
      expect(createOptions().map((option) => option.textContent)).toEqual([
        'Create "R&D <plan>" sub-page',
        'Create "R&D <plan>" page in...',
      ]);
      expect(screen.getAllByTestId('mention-create-page-name').map((name) => name.textContent)).toEqual([
        'R&D <plan>',
        'R&D <plan>',
      ]);
    });

    it('offers no page to create while the skeleton stands in for the results', async () => {
      mockEditorContext.addPage = jest.fn();
      mockEditorContext.viewId = 'current-page';
      mockEditorContext.searchMentions = createSearch(answerRoad, 500);
      mockPanelContext.searchText = '';

      const view = renderPanel();

      await advance(600);
      mockPanelContext.searchText = 'road';
      view.rerender();
      await advance(200);
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(createOptions()).toHaveLength(0);

      await advance(500);
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(createOptions()).toHaveLength(2);
    });

    it("never offers a page to create in a picker that can't create pages, as a Text cell's", async () => {
      mockEditorContext.addPage = jest.fn();
      mockEditorContext.viewId = 'current-page';
      await openAndType('road', { canCreatePages: false });

      expect(sectionKinds()).toContain(MentionSearchSectionKind.Databases);
      expect(createOptions()).toHaveLength(0);
    });

    it("lays out the picker v2's provisional list the same way while the typed answer is pending", async () => {
      localStorage.setItem(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, 'true');
      // The bare answer lists what the user typed for; the typed answer never comes.
      mockEditorContext.searchMentions = jest.fn((request: MentionSearchRequest) =>
        laneOf(request) === 'bare'
          ? Promise.resolve<MentionSearchResponse>({
              sections: [
                section(MentionSearchSectionKind.Pages, PAGES),
                section(MentionSearchSectionKind.Databases, [ROAD_DATABASE]),
              ],
            })
          : new Promise<MentionSearchResponse>(() => undefined)
      );
      mockPanelContext.searchText = '';

      const view = renderPanel();

      await advance(100);
      expect(sectionKinds()).toEqual([MentionSearchSectionKind.Pages, MentionSearchSectionKind.Databases]);

      mockPanelContext.searchText = 'road';
      view.rerender();
      expect(titlesIn(MentionSearchSectionKind.Pages)).toEqual(['Road 1', 'Road 2', 'Road 3', 'Road 4']);
      expect(moreRowIn(MentionSearchSectionKind.Pages)?.textContent).toBe('1 more results...');
      expect(titlesIn(MentionSearchSectionKind.Databases)).toEqual(['Road database']);
    });
  });
});
