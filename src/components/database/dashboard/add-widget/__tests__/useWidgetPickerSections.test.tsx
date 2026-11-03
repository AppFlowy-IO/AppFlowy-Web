import { act, renderHook } from '@testing-library/react';

import { ViewLayout } from '@/application/types';

import { HostViewEntry } from '../picker-sections';
import { useWidgetPickerSections, WidgetPickerListState } from '../useWidgetPickerSections';

// Every mocked input is a stable value: only the query may change between renders.
const mockHostViews: HostViewEntry[] = [
  { viewId: 'g', name: 'Grid', layout: ViewLayout.Grid, embedded: false },
  { viewId: 'b', name: 'Beta', layout: ViewLayout.Board, embedded: false },
];
const mockHostViewIds = ['g', 'b'];
const mockCatalog: never[] = [];
const mockDatabaseContext = {
  activeViewId: 'dash',
  workspaceId: 'workspace',
  createDatabaseView: jest.fn(),
  loadView: jest.fn(),
  databaseDoc: undefined,
};
const mockSources = { sourceDocs: {}, sourceNames: {} };
const mockT = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);
const mockExclude: string[] = [];

jest.mock('@/application/database-yjs', () => ({
  useDatabase: () => undefined,
  useDatabaseContext: () => mockDatabaseContext,
}));
jest.mock('../../DashboardContext', () => ({
  useDashboardContext: () => ({ hostDatabaseId: 'host-db', dashboardViewId: 'dash' }),
  useDashboardLayout: () => ({ hostViewIds: mockHostViewIds }),
  useDashboardSources: () => mockSources,
}));
jest.mock('../../DashboardUiContext', () => ({
  useDashboardHost: () => ({ workspaceId: 'workspace', getSubscriptions: undefined }),
}));
jest.mock('../../hooks/useHostViews', () => ({ useHostViews: () => mockHostViews }));
jest.mock('../../hooks/useWidgetSourceName', () => ({ useWidgetSourceName: () => 'Projects' }));
jest.mock('../../hooks/useWorkspaceDatabases', () => ({
  useWorkspaceDatabases: () => ({ databases: mockCatalog, loading: false, error: null }),
}));
jest.mock('@/components/app/hooks/useTimelineCreationDisabledReason', () => ({
  useTimelineCreationDisabledReason: () => undefined,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));

describe('useWidgetPickerSections', () => {
  it('keeps the list object through the urgent render of a keystroke, so the memoized list skips it', () => {
    const lists: WidgetPickerListState[] = [];
    const { result } = renderHook(() => {
      const picker = useWidgetPickerSections({ mode: 'add', primaryDatabaseId: 'host-db', excludeViewIds: mockExclude });

      lists.push(picker.list);
      return picker;
    });

    expect(lists).toHaveLength(1);
    expect(result.current.list).not.toHaveProperty('query');
    expect(result.current.list.sections.host?.options.map((option) => option.viewId)).toEqual(['g', 'b']);

    act(() => result.current.setQuery('be'));

    // The urgent render still shows the previous sections (the query is
    // deferred): the same list object. The deferred render brings the match.
    expect(lists.length).toBeGreaterThanOrEqual(3);
    expect(lists[1]).toBe(lists[0]);
    expect(lists[lists.length - 1]).not.toBe(lists[0]);
    expect(result.current.query).toBe('be');
    expect(result.current.list.sections.host?.options.map((option) => option.viewId)).toEqual(['b']);
  });

  it('is the same object again when nothing the list reads changed', () => {
    const { result, rerender } = renderHook(() =>
      useWidgetPickerSections({ mode: 'replace', primaryDatabaseId: 'host-db', excludeViewIds: mockExclude })
    );
    const list = result.current.list;

    rerender();
    expect(result.current.list).toBe(list);
    expect(list).toMatchObject({ catalogLoading: false, catalogFailed: false, primaryDatabaseName: 'Projects' });
  });
});
