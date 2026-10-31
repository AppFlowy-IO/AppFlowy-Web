import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

import { View } from '@/application/types';

import { DashboardSourcesContext, DashboardSourcesContextValue } from '../DashboardContext';
import { DashboardHostContext, DashboardHostServices } from '../DashboardUiContext';
import { useWidgetSourceName } from '../hooks/useWidgetSourceName';

const view = (view_id: string, name: string, extra: Partial<View> = {}) => ({ view_id, name, ...extra } as View);

// The lookups are cached per workspace for the life of the module: every test gets its own.
let workspaces = 0;

/** A workspace whose pages can be renamed and whose lookups can fail. */
function createWorkspace() {
  workspaces += 1;
  const workspaceId = `workspace-${workspaces}`;
  const pages = new Map<string, View>([
    ['tasks-container', view('tasks-container', 'Tasks', { extra: { is_database_container: true } } as Partial<View>)],
    ['tasks-grid', view('tasks-grid', 'Tasks Grid', { parent_view_id: 'tasks-container' })],
    ['notes-grid', view('notes-grid', ' Notes ', { parent_view_id: 'a-document' })],
    ['a-document', view('a-document', 'Some page')],
  ]);
  const firstViews: Record<string, string | null> = { 'tasks-db': 'tasks-grid', 'notes-db': 'notes-grid' };
  const getViewIdFromDatabaseId = jest.fn(async (databaseId: string) => firstViews[databaseId] ?? null);
  const loadViewMeta = jest.fn(async (viewId: string) => {
    const page = pages.get(viewId);

    if (!page) throw new Error('View not found');
    return page;
  });

  return { workspaceId, pages, getViewIdFromDatabaseId, loadViewMeta };
}

function renderSourceName(
  workspace: ReturnType<typeof createWorkspace>,
  { databaseId = 'tasks-db', enabled = true, sourceNames = {} as Record<string, string> } = {}
) {
  const props = { databaseId, enabled };
  const host = {
    workspaceId: workspace.workspaceId,
    loadViewMeta: workspace.loadViewMeta,
    getViewIdFromDatabaseId: workspace.getViewIdFromDatabaseId,
  } as unknown as DashboardHostServices;
  const sources = { sourceNames } as DashboardSourcesContextValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DashboardHostContext.Provider value={host}>
      <DashboardSourcesContext.Provider value={sources}>{children}</DashboardSourcesContext.Provider>
    </DashboardHostContext.Provider>
  );
  const hook = renderHook(() => useWidgetSourceName(props.databaseId, props.enabled), { wrapper });

  return {
    ...hook,
    /** The tooltip closes and opens again. */
    reopen: async () => {
      props.enabled = false;
      hook.rerender();
      props.enabled = true;
      hook.rerender();
      await act(() => Promise.resolve());
    },
  };
}

describe('useWidgetSourceName', () => {
  it('uses the name the dashboard already knows, without a lookup', () => {
    const workspace = createWorkspace();
    const { result } = renderSourceName(workspace, { sourceNames: { 'tasks-db': 'Projects' } });

    expect(result.current).toBe('Projects');
    expect(workspace.getViewIdFromDatabaseId).not.toHaveBeenCalled();
  });

  it('looks nothing up until it is enabled (the tooltip opened)', () => {
    const workspace = createWorkspace();
    const { result } = renderSourceName(workspace, { enabled: false });

    expect(result.current).toBeNull();
    expect(workspace.getViewIdFromDatabaseId).not.toHaveBeenCalled();
  });

  it('names a database after its container page, else after the page of its first view', async () => {
    const workspace = createWorkspace();
    const tasks = renderSourceName(workspace);

    await waitFor(() => expect(tasks.result.current).toBe('Tasks'));

    const notes = renderSourceName(workspace, { databaseId: 'notes-db' });

    await waitFor(() => expect(notes.result.current).toBe('Notes'));
  });

  it('resolves the page of a database once for every widget and every hover', async () => {
    const workspace = createWorkspace();
    const first = renderSourceName(workspace);
    const second = renderSourceName(workspace);

    await waitFor(() => expect(second.result.current).toBe('Tasks'));
    await first.reopen();
    expect(first.result.current).toBe('Tasks');
    expect(workspace.getViewIdFromDatabaseId).toHaveBeenCalledTimes(1);
  });

  it('retries a failed lookup the next time it is asked', async () => {
    const workspace = createWorkspace();

    workspace.getViewIdFromDatabaseId.mockRejectedValueOnce(new Error('offline'));
    const { result, reopen } = renderSourceName(workspace);

    await waitFor(() => expect(workspace.getViewIdFromDatabaseId).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(result.current).toBeNull();

    // The failure is not cached: the next hover finds the name.
    await reopen();
    await waitFor(() => expect(result.current).toBe('Tasks'));
    expect(workspace.getViewIdFromDatabaseId).toHaveBeenCalledTimes(2);
  });

  it('retries after the page of the database could not be read', async () => {
    const workspace = createWorkspace();

    workspace.loadViewMeta.mockRejectedValueOnce(new Error('View not found'));
    const { result, reopen } = renderSourceName(workspace);

    await waitFor(() => expect(workspace.loadViewMeta).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(result.current).toBeNull();

    await reopen();
    await waitFor(() => expect(result.current).toBe('Tasks'));
    expect(workspace.getViewIdFromDatabaseId).toHaveBeenCalledTimes(2);
  });

  it('retries for a database that had no page yet', async () => {
    const workspace = createWorkspace();

    workspace.getViewIdFromDatabaseId.mockResolvedValueOnce(null);
    const { result, reopen } = renderSourceName(workspace);

    await waitFor(() => expect(workspace.getViewIdFromDatabaseId).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(result.current).toBeNull();

    await reopen();
    await waitFor(() => expect(result.current).toBe('Tasks'));
  });

  it('shows the new name of a renamed database the next time it is asked', async () => {
    const workspace = createWorkspace();
    const { result, reopen } = renderSourceName(workspace);

    await waitFor(() => expect(result.current).toBe('Tasks'));
    workspace.pages.set(
      'tasks-container',
      view('tasks-container', 'Roadmap', { extra: { is_database_container: true } } as Partial<View>)
    );

    await reopen();
    await waitFor(() => expect(result.current).toBe('Roadmap'));
    // Only the name is read again, not the page the database is named after.
    expect(workspace.getViewIdFromDatabaseId).toHaveBeenCalledTimes(1);
  });
});
