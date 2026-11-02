import { act, renderHook, waitFor } from '@testing-library/react';

import {
  MentionSearchResponse,
  MentionSearchSectionKind,
  MentionTargetKind,
  UIVariant,
  View,
  ViewIconType,
  ViewLayout,
} from '@/application/types';
import { useEditorContext } from '@/components/editor/EditorContext';

import { useImageLinkPages } from '../useImageLinkPages';

jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: jest.fn() }));
const mockContext = jest.mocked(useEditorContext);
const loadViews = jest.fn();
const searchMentions = jest.fn();
const loadViewMeta = jest.fn();
const page = (id: string, overrides: Partial<View> = {}): View => ({
  view_id: id,
  name: id,
  icon: null,
  layout: ViewLayout.Document,
  children: [],
  extra: null,
  is_private: false,
  is_published: false,
  ...overrides,
});
const response = (...ids: string[]): MentionSearchResponse => ({
  sections: [
    {
      kind: MentionSearchSectionKind.Pages,
      title: 'Pages',
      status: 'ok',
      has_more: false,
      items: ids.map((id) => ({
        kind: MentionTargetKind.Page,
        title: id,
        mention: { type: MentionTargetKind.Page, page_id: id },
      })),
    },
  ],
});
function context(overrides: Partial<ReturnType<typeof useEditorContext>> = {}) {
  mockContext.mockReturnValue({ workspaceId: 'workspace', viewId: 'current', loadViews, ...overrides } as ReturnType<
    typeof useEditorContext
  >);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  context();
});

it('uses the recent endpoint, excludes the current page and spaces, deduplicates and preserves order/icons', async () => {
  const recent = page('recent', { icon: { ty: ViewIconType.Emoji, value: '⚡' } });
  loadViews.mockResolvedValue([
    page('current'),
    page('space', { is_space: true }),
    page('embedded', { extra: { embedded: true } }),
    recent,
    recent,
    ...Array.from({ length: 8 }, (_, i) => page(`page-${i}`)),
  ]);
  const { result } = renderHook(() => useImageLinkPages('', false));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(loadViews).toHaveBeenCalledWith(UIVariant.Recent);
  expect(result.current.pages.map((item) => item.view_id)).toEqual(['recent', 'page-0', 'page-1', 'page-2', 'page-3']);
  expect(result.current.pages[0].icon).toEqual(recent.icon);
});

it('searches nested pages in hosts without server search, without listing spaces or database rows', async () => {
  loadViews.mockResolvedValue([
    page('space', {
      is_space: true,
      name: 'Design space',
      children: [
        page('parent', { children: [page('nested', { name: 'Design reference' })] }),
        page('db', { name: 'Design list', layout: ViewLayout.List, children: [page('row', { name: 'Design row' })] }),
      ],
    }),
  ]);
  const { result } = renderHook(() => useImageLinkPages('design', false));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(loadViews).toHaveBeenCalledWith();
  expect(result.current.pages.map((item) => item.view_id)).toEqual(['nested', 'db']);
});

it('searches all workspace pages, filters inaccessible results and hydrates real page icons', async () => {
  const found = response('current', 'design', 'design', 'private');
  found.sections[0].items[3].can_access_context = false;
  searchMentions.mockResolvedValue(found);
  const metadata = page('design', { icon: { ty: ViewIconType.Emoji, value: '⚡' } });
  loadViewMeta.mockResolvedValue(metadata);
  context({ searchMentions, loadViewMeta });
  const { result } = renderHook(() => useImageLinkPages('design', false));
  await waitFor(() => expect(result.current.pages[0]?.icon).toEqual(metadata.icon));
  expect(searchMentions).toHaveBeenCalledWith({
    query: 'design',
    limit: 11,
    include: [MentionTargetKind.Page, MentionTargetKind.Database],
    context: { view_id: 'current' },
  });
  expect(result.current.pages).toEqual([metadata]);
  expect(loadViews).not.toHaveBeenCalled();
});

it('debounces typing and ignores late results from the previous query', async () => {
  const first = deferred<MentionSearchResponse>();
  searchMentions.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response('new page'));
  context({ searchMentions });
  const { result, rerender } = renderHook(({ query }) => useImageLinkPages(query, false), {
    initialProps: { query: 'old' },
  });
  await waitFor(() => expect(searchMentions).toHaveBeenCalledTimes(1));
  rerender({ query: 'n' });
  rerender({ query: 'new' });
  expect(result.current.pages).toEqual([]);
  await waitFor(() => expect(result.current.pages[0]?.name).toBe('new page'));
  await act(async () => first.resolve(response('old page')));
  expect(result.current.pages[0].name).toBe('new page');
  expect(searchMentions.mock.calls.map(([request]) => request.query)).toEqual(['old', 'new']);
});

it('ignores late icon metadata when the user switches to a URL, without searching the URL', async () => {
  const metadata = deferred<View>();
  searchMentions.mockResolvedValue(response('design'));
  loadViewMeta.mockReturnValue(metadata.promise);
  context({ searchMentions, loadViewMeta });
  const { result, rerender } = renderHook(({ query, url }) => useImageLinkPages(query, url), {
    initialProps: { query: 'design', url: false },
  });
  await waitFor(() => expect(result.current.pages[0]?.name).toBe('design'));
  rerender({ query: 'https://example.com', url: true });
  await act(async () => metadata.resolve(page('design')));
  expect(result.current).toEqual({ pages: [], loading: false, failed: false });
  expect(searchMentions).toHaveBeenCalledTimes(1);
});

it('reports search failures without presenting them as an empty successful result', async () => {
  searchMentions.mockRejectedValue(new Error('Unavailable'));
  context({ searchMentions });
  const { result } = renderHook(() => useImageLinkPages('design', false));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.loading).toBe(false);
  expect(result.current.pages).toEqual([]);
});
