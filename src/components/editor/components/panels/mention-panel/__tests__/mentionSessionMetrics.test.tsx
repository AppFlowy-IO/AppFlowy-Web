import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactNode, StrictMode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import {
  MENTION_FEATURE_SESSION_METRICS_V1,
  MentionPickerSessionReport,
  resetMentionSessionMetricsForTests,
} from '@/application/services/js-services/http/mention-presentation-metrics';
import {
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
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelProvider, PanelType } from '@/components/editor/components/panels/PanelsContext';
import { getConfigValue } from '@/utils/runtime-config';
import { SERVER_INFO_LOADING, ServerInfoState, updateServerInfo } from '@/utils/server-info';

import { MentionPanel } from '../MentionPanel';
import { clearMentionSearchCacheForTests, MENTION_SEARCH_CACHE_FRESH_MS } from '../mentionSearchCache';

const mockPost = jest.fn();
const mockAddMark = jest.fn();
const mockEditorContext: Record<string, unknown> = {};

jest.mock('@/application/services/js-services/http/core', () => ({ getAxios: () => ({ post: mockPost }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: {} }));
jest.mock('../useNotifyPersonMention', () => ({ useNotifyPersonMention: () => jest.fn() }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { addMark: (...args: unknown[]) => mockAddMark(...args) },
}));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => mockEditorContext }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => undefined }));
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
const ADVERTISED: ServerInfoState = {
  status: 'available',
  info: { enable_page_history: true, mention_features: [MENTION_FEATURE_SESSION_METRICS_V1] },
};
const ANSWER_MS = 40;
const TYPING_DEBOUNCE_MS = 120;

type Lane = 'bare' | 'primary' | 'rows';
type Answer = (lane: Lane, query: string) => MentionSearchResponse | Error;

function section(kind: MentionSearchSectionKind, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title: kind, items, has_more: false, status: 'ready' };
}

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

function personItem(name: string): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Person,
    object_id: name,
    title: name,
    mention: { type: MentionTargetKind.Person, person_id: name, person_name: name, page_id: 'page' },
  };
}

function isRowRequest(request: MentionSearchRequest) {
  return request.include?.length === 1 && request.include[0] === MentionTargetKind.DatabaseRow;
}

function laneOf(request: MentionSearchRequest): Lane {
  if (!request.query) return 'bare';
  return isRowRequest(request) ? 'rows' : 'primary';
}

// Answers after `delayMs`, or rejects as cancelled as soon as the request is aborted, like axios.
function createSearch(answer: Answer, delayMs = ANSWER_MS) {
  return jest.fn(
    (request: MentionSearchRequest, options?: MentionSearchOptions) =>
      new Promise<MentionSearchResponse>((resolve, reject) => {
        const cancelled = { code: -1, message: 'canceled', sourceDomain: 'transport', transportFailure: 'cancelled' };

        if (options?.signal?.aborted) {
          reject(cancelled);
          return;
        }

        const timer = setTimeout(() => {
          const response = answer(laneOf(request), request.query ?? '');

          if (response instanceof Error) reject(response);
          else resolve(response);
        }, delayMs);

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

const RECENT: MentionSearchResponse = { sections: [section(MentionSearchSectionKind.Pages, [pageItem('Recent page')])] };

// The bare '@' lists a recent page. "road" finds two people, then a page, then a row: the third
// result is the first one of Pages.
const roadAnswer: Answer = (lane, query) => {
  if (lane === 'bare') return RECENT;
  if (query !== 'road' && query !== 'roadmap') return { sections: [] };
  if (lane === 'rows') return { sections: [section(MentionSearchSectionKind.Pages, [rowItem('Road row')])] };
  return {
    sections: [
      section(MentionSearchSectionKind.People, [personItem('Ada Road'), personItem('Bob Road')]),
      section(MentionSearchSectionKind.Pages, [pageItem('Road map')]),
    ],
  };
};

// Opens a panel from a menu, as the slash menu's "Link to page" does.
function MenuProbe() {
  const { openPanel } = usePanelContext();

  return (
    <button data-testid='menu-link-to-page' onClick={() => openPanel(PanelType.PageReference, { top: 0, left: 0 })} />
  );
}

/**
 * An editor with the real panel provider. With `mounted: false` the mention panel mounts only on
 * `mountPanel()`, so it can mount while a panel is already open, as StrictMode then replays its
 * effects.
 */
function renderEditor({ strict = false, mounted = true }: { strict?: boolean; mounted?: boolean } = {}) {
  const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });
  const panel = <MentionPanel notifyOnInsert={false} />;
  const tree = (withPanel: boolean) => (
    <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: 'See ' }] }]}>
      <PanelProvider editor={editor}>
        <Editable data-testid='editor' />
        {withPanel && (strict ? <StrictMode>{panel}</StrictMode> : panel)}
        <MenuProbe />
      </PanelProvider>
    </Slate>
  );
  const view = render(tree(mounted));

  return Object.assign(editor, {
    mountPanel: () =>
      act(async () => {
        view.rerender(tree(true));
      }),
  });
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

async function pressEscape() {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Escape' });
  });
}

async function pick(title: string) {
  await act(async () => {
    fireEvent.click(screen.getByText(title).closest('button') as HTMLElement);
  });
}

function sentReports(): MentionPickerSessionReport[] {
  return mockPost.mock.calls.map(([, body]) => body as MentionPickerSessionReport);
}

function onlyReport(): MentionPickerSessionReport {
  expect(mockPost).toHaveBeenCalledTimes(1);
  return sentReports()[0];
}

function panelIsOpen() {
  return screen.queryByTestId('mention-panel') !== null;
}

describe('MentionPanel session metrics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPost.mockResolvedValue({ status: 204, data: '' });
    clearMentionSearchCacheForTests();
    resetMentionSessionMetricsForTests();
    localStorage.clear();
    Object.keys(mockEditorContext).forEach((key) => delete mockEditorContext[key]);
    mockEditorContext.workspaceId = 'workspace';
    updateServerInfo(SERVER_URL, ADVERTISED);
  });

  afterEach(() => {
    cleanup();
    updateServerInfo(SERVER_URL, SERVER_INFO_LOADING);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reports one session: the third result across a section boundary is rank 3, without the query', async () => {
    const search = createSearch(roadAnswer);

    mockEditorContext.searchMentions = search;
    const editor = renderEditor();

    await type(editor, '@');
    await advance(ANSWER_MS);
    expect(screen.getByText('Recent page')).toBeTruthy();

    await type(editor, 'road');
    await advance(TYPING_DEBOUNCE_MS + ANSWER_MS);
    expect(Array.from(document.querySelectorAll('[data-option-key]')).map((option) => option.getAttribute('data-option-key'))).toEqual([
      'people|person:Ada Road',
      'people|person:Bob Road',
      'pages|page:Road map',
      'pages|row:database:Road row',
    ]);
    expect(mockPost).not.toHaveBeenCalled();

    await pick('Road map');
    expect(mockAddMark).toHaveBeenCalledTimes(1);
    expect(panelIsOpen()).toBe(false);

    const [url, body, config] = mockPost.mock.calls[0];

    expect(url).toBe('/api/workspace/workspace/mentions/metrics');
    expect(config).toEqual({ timeout: 3_000, skipTransportRetry: true, skipAuthRefresh: true });
    expect(onlyReport()).toEqual({
      client: 'web',
      trigger: 'at',
      outcome: 'selected',
      query_len: 4,
      selected_rank: 3,
      selected_section: 'pages',
      selected_source: 'server',
      // Times are from the '@': the bare answer painted first, the pick came after the typed one.
      time_to_first_paint_ms: ANSWER_MS,
      server_ms: ANSWER_MS,
      time_to_select_ms: ANSWER_MS + TYPING_DEBOUNCE_MS + ANSWER_MS,
      // The bare request, then the typed primary and rows requests.
      requests_sent: 3,
      requests_aborted: 0,
      zero_result_shown: false,
    });
    expect(search).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(body)).not.toMatch(/road|recent|ada|bob|workspace/i);

    cleanup();
    await act(async () => undefined);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('ranks only results on screen: "N more" holds no position, and expanding it ranks what it reveals', async () => {
    const today: MentionSearchResultItem = {
      kind: MentionTargetKind.Date,
      title: 'Today',
      subtitle: '2026-11-10',
      mention: { type: MentionTargetKind.Date, date: '2026-11-10T09:00:00+08:00', include_time: false },
    };

    mockEditorContext.searchMentions = createSearch(() => ({
      sections: [
        section(MentionSearchSectionKind.Pages, ['One', 'Two', 'Three', 'Four', 'Five'].map(pageItem)),
        section(MentionSearchSectionKind.Dates, [today]),
      ],
    }));
    const editor = renderEditor();

    // Four pages, "1 more", then Today: Today is the fifth result.
    await type(editor, '@');
    await advance(ANSWER_MS);
    expect(screen.queryByText('Five')).toBeNull();
    await pick('Today');

    // Expanded, the fifth page shows, and Today becomes the sixth result.
    await type(editor, ' @');
    await act(async () => {
      fireEvent.click(screen.getByText('document.mention.moreResults').closest('button') as HTMLElement);
    });
    await pick('Five');
    await type(editor, ' @');
    await act(async () => {
      fireEvent.click(screen.getByText('document.mention.moreResults').closest('button') as HTMLElement);
    });
    await pick('Today');

    expect(sentReports().map(({ selected_rank, selected_section }) => [selected_rank, selected_section])).toEqual([
      [5, 'dates'],
      [5, 'pages'],
      [6, 'dates'],
    ]);
  });

  it('reports a session closed without a pick as dismissed, without selection fields', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer);
    const editor = renderEditor();

    await type(editor, '@');
    await advance(ANSWER_MS);
    await pressEscape();

    expect(panelIsOpen()).toBe(false);
    expect(onlyReport()).toEqual({
      client: 'web',
      trigger: 'at',
      outcome: 'dismissed',
      query_len: 0,
      time_to_first_paint_ms: ANSWER_MS,
      server_ms: ANSWER_MS,
      requests_sent: 1,
      requests_aborted: 0,
      zero_result_shown: false,
    });
  });

  it('reports each opening of the panel as its own session', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer);
    const editor = renderEditor();

    await type(editor, '@');
    await advance(ANSWER_MS);
    await pressEscape();
    // The second '@' paints the cached answer at once, and needs no request while it is fresh.
    await type(editor, ' @');
    await pick('Recent page');

    expect(sentReports()).toEqual([
      expect.objectContaining({ outcome: 'dismissed', requests_sent: 1 }),
      {
        client: 'web',
        trigger: 'at',
        outcome: 'selected',
        query_len: 0,
        selected_rank: 1,
        selected_section: 'pages',
        selected_source: 'cache',
        time_to_first_paint_ms: 0,
        time_to_select_ms: 0,
        requests_sent: 0,
        requests_aborted: 0,
        zero_result_shown: false,
      },
    ]);
  });

  it('reports a stale cached answer as the cache until its refresh answers, then as the server', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer);
    const editor = renderEditor();

    await type(editor, '@');
    await advance(ANSWER_MS);
    await pressEscape();

    // Stale: painted at once and refreshed; a pick before the refresh answers is the cache's.
    await advance(MENTION_SEARCH_CACHE_FRESH_MS);
    await type(editor, ' @');
    await pick('Recent page');
    // The refresh still answers after the pick, and caches its answer again.
    await advance(ANSWER_MS);

    await advance(MENTION_SEARCH_CACHE_FRESH_MS);
    await type(editor, ' @');
    await advance(ANSWER_MS);
    await pick('Recent page');

    const [, beforeRefresh, afterRefresh] = sentReports();

    expect(beforeRefresh).toMatchObject({ selected_source: 'cache', time_to_first_paint_ms: 0, requests_sent: 1 });
    expect(beforeRefresh).not.toHaveProperty('server_ms');
    expect(afterRefresh).toMatchObject({
      selected_source: 'server',
      time_to_first_paint_ms: 0,
      server_ms: ANSWER_MS,
      requests_sent: 1,
    });
  });

  it.each<[string, ServerInfoState]>([
    ['the server does not list mention_features', { status: 'available', info: { enable_page_history: true } }],
    [
      'the server lists other mention features',
      { status: 'available', info: { enable_page_history: true, mention_features: ['section_degradation_v1'] } },
    ],
    ['server info is still loading', SERVER_INFO_LOADING],
    ['server info failed to load', { status: 'unavailable' }],
  ])('sends nothing when %s', async (_name, serverInfo) => {
    updateServerInfo(SERVER_URL, serverInfo);
    const search = createSearch(roadAnswer);

    mockEditorContext.searchMentions = search;
    const editor = renderEditor();

    await type(editor, '@');
    await advance(ANSWER_MS);
    await pick('Recent page');
    await type(editor, ' @');
    await advance(ANSWER_MS);
    await pressEscape();
    cleanup();
    await act(async () => undefined);

    expect(mockAddMark).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([
    ['@', 'at'],
    ['+', 'plus'],
    ['[[', 'page_link'],
  ])('reports the trigger %s as %s', async (trigger, label) => {
    mockEditorContext.searchMentions = createSearch(roadAnswer);
    const editor = renderEditor();

    await type(editor, trigger);
    await advance(ANSWER_MS);
    expect(panelIsOpen()).toBe(true);
    await pressEscape();

    expect(onlyReport()).toMatchObject({ trigger: label, outcome: 'dismissed' });
  });

  it('reports the trigger of a panel its key opened before any text was inserted', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer);
    const editor = renderEditor();
    const editable = screen.getByTestId('editor');

    // jsdom has no isContentEditable, which the provider's key listener checks for its target.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    await act(async () => {
      Transforms.select(editor, Editor.end(editor, []));
      fireEvent.keyDown(editable, { key: '+' });
    });
    // The key opens the panel on the next tick.
    await advance(0);
    expect(panelIsOpen()).toBe(true);
    await advance(ANSWER_MS);
    await pressEscape();

    expect(onlyReport()).toMatchObject({ trigger: 'plus', outcome: 'dismissed', requests_sent: 1 });
  });

  it('sends nothing for a picker a menu opened, which has no trigger Cloud counts', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer);
    const editor = renderEditor();

    await act(async () => {
      Transforms.select(editor, Editor.end(editor, []));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('menu-link-to-page'));
    });
    await advance(ANSWER_MS);
    await pick('Recent page');

    expect(mockAddMark).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('reports that "No result" was shown', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer);
    const editor = renderEditor();

    await type(editor, '@');
    await advance(ANSWER_MS);
    await type(editor, 'zzz');
    await advance(TYPING_DEBOUNCE_MS + ANSWER_MS);
    expect(screen.getByText('findAndReplace.noResult')).toBeTruthy();
    await pressEscape();

    expect(onlyReport()).toMatchObject({
      outcome: 'dismissed',
      query_len: 3,
      zero_result_shown: true,
      requests_sent: 3,
    });
  });

  it('counts the typed requests that a newer query aborted', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer, 400);
    const editor = renderEditor();

    await type(editor, '@');
    await advance(400);
    await type(editor, 'road');
    // The "road" pair is sent, then "map" is typed while it is pending.
    await advance(TYPING_DEBOUNCE_MS + 100);
    await type(editor, 'map');
    await advance(TYPING_DEBOUNCE_MS + 400);
    expect(screen.getByText('Road map')).toBeTruthy();
    await pressEscape();

    expect(onlyReport()).toMatchObject({ query_len: 7, requests_sent: 5, requests_aborted: 2 });
  });

  it('counts the typed requests that closing the panel aborted', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer, 400);
    const editor = renderEditor();

    await type(editor, '@');
    await advance(400);
    await type(editor, 'road');
    await advance(TYPING_DEBOUNCE_MS + 100);
    await pressEscape();

    expect(onlyReport()).toMatchObject({ requests_sent: 3, requests_aborted: 2 });
  });

  it('reports a session that closed while it could not show results as an error', async () => {
    mockEditorContext.searchMentions = createSearch((lane) => (lane === 'bare' ? RECENT : new Error('503')));
    const editor = renderEditor();

    await type(editor, '@');
    await advance(ANSWER_MS);
    await type(editor, 'road');
    await advance(TYPING_DEBOUNCE_MS + ANSWER_MS);
    expect(document.querySelector('[data-testid="mention-panel-retry"]')).not.toBeNull();
    await pressEscape();

    expect(onlyReport()).toMatchObject({ outcome: 'error', query_len: 4, zero_result_shown: false });
  });

  it('reports a session that the editor unmounted while it was open', async () => {
    mockEditorContext.searchMentions = createSearch(roadAnswer);
    const editor = renderEditor();

    await type(editor, '@');
    await advance(ANSWER_MS);
    expect(mockPost).not.toHaveBeenCalled();

    cleanup();
    await act(async () => undefined);
    expect(onlyReport()).toMatchObject({ outcome: 'dismissed', requests_sent: 1 });
  });

  it("keeps the session through StrictMode's replay of its effects, and reports it once", async () => {
    const search = createSearch(roadAnswer);

    mockEditorContext.searchMentions = search;
    const editor = renderEditor({ strict: true, mounted: false });

    await type(editor, '@');
    // The panel mounts open: StrictMode runs its effects, cleans them up and runs them again.
    await editor.mountPanel();
    await advance(ANSWER_MS);
    expect(mockPost).not.toHaveBeenCalled();
    await pick('Recent page');

    expect(search).toHaveBeenCalledTimes(1);
    expect(onlyReport()).toMatchObject({
      outcome: 'selected',
      selected_rank: 1,
      time_to_first_paint_ms: ANSWER_MS,
      requests_sent: 1,
    });
  });

  describe('without a server search', () => {
    beforeEach(() => {
      mockEditorContext.loadViews = jest.fn(async () => [
        { view_id: 'roadmap', name: 'Roadmap', layout: ViewLayout.Document, children: [] } as unknown as View,
      ]);
    });

    it('reports a local page as picked from the local lane', async () => {
      const editor = renderEditor();

      await type(editor, '@');
      await advance(0);
      await pick('Roadmap');

      expect(onlyReport()).toMatchObject({
        outcome: 'selected',
        selected_rank: 1,
        selected_section: 'pages',
        selected_source: 'local',
        requests_sent: 0,
      });
    });

    it('reports a created page as a selection without a rank, a section or a source', async () => {
      mockEditorContext.viewId = 'current-page';
      mockEditorContext.addPage = jest.fn(async () => ({ view_id: 'new-page' }));
      const editor = renderEditor();

      await type(editor, '@Plan');
      await advance(0);
      const create = document.querySelector<HTMLElement>('[data-option-key="createPage:pageReference"]');

      expect(create).not.toBeNull();
      await act(async () => {
        fireEvent.click(create as HTMLElement);
      });

      expect(mockAddMark).toHaveBeenCalledTimes(1);
      const report = onlyReport();

      expect(report).toMatchObject({ outcome: 'selected', query_len: 4, zero_result_shown: true });
      expect(report).not.toHaveProperty('selected_rank');
      expect(report).not.toHaveProperty('selected_section');
      expect(report).not.toHaveProperty('selected_source');
    });
  });
});
