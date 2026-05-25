import { View, ViewLayout } from '@/application/types';
import { resolveAncestorViewIds } from '@/components/app/hooks/resolveAncestorViewIds';

const WORKSPACE_ID = 'workspace-root';

function makeView(view_id: string, parent_view_id: string | undefined, overrides: Partial<View> = {}): View {
  return {
    view_id,
    name: view_id,
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
    parent_view_id,
    ...overrides,
  };
}

/**
 * Build a nested outline tree: space → folder → page (3 levels deep).
 * Returns both the tree and the individual views so tests can shape shallow vs.
 * full outlines and back a remote `fetchView`.
 */
function buildTree() {
  const page = makeView('page', 'folder');
  const folder = makeView('folder', 'space', { children: [page] });
  const space = makeView('space', WORKSPACE_ID, { extra: { is_space: true }, children: [folder] });

  return { space, folder, page };
}

describe('resolveAncestorViewIds', () => {
  it('reads the ancestor chain straight from the loaded tree without fetching (fast path)', async () => {
    const { space, folder, page } = buildTree();
    const fetchView = jest.fn(async () => null as View | null);

    const result = await resolveAncestorViewIds({
      selectedViewId: page.view_id,
      workspaceId: WORKSPACE_ID,
      outline: [space],
      fetchView,
    });

    // Ancestors are returned root-first, excluding the selected leaf.
    expect(result).toEqual(['space', 'folder']);
    expect(fetchView).not.toHaveBeenCalled();
  });

  it('returns an empty array for a top-level space (nothing to expand)', async () => {
    const { space } = buildTree();
    const fetchView = jest.fn(async () => null as View | null);

    const result = await resolveAncestorViewIds({
      selectedViewId: space.view_id,
      workspaceId: WORKSPACE_ID,
      outline: [space],
      fetchView,
    });

    expect(result).toEqual([]);
    expect(fetchView).not.toHaveBeenCalled();
  });

  it('walks parent_view_id from remote when the view is absent from the shallow outline', async () => {
    const { space, folder, page } = buildTree();
    // Shallow outline: only the top-level space, no children loaded.
    const shallowSpace = makeView('space', WORKSPACE_ID, { extra: { is_space: true }, children: [], has_children: true });

    const remote: Record<string, View> = { page, folder, space };
    const fetchView = jest.fn(async (_workspaceId: string, viewId: string) => remote[viewId] ?? null);

    const result = await resolveAncestorViewIds({
      selectedViewId: page.view_id,
      workspaceId: WORKSPACE_ID,
      outline: [shallowSpace],
      fetchView,
    });

    expect(result).toEqual(['space', 'folder']);
    // page (missing) and folder (missing) are fetched; space is already in the
    // outline so it is read locally rather than fetched.
    expect(fetchView.mock.calls.map((c) => c[1])).toEqual(['page', 'folder']);
  });

  it('only fetches the nodes missing from the outline (mixed path)', async () => {
    const { space, folder, page } = buildTree();
    // Outline has the space + folder, but not the deeply-nested page.
    const partialFolder = makeView('folder', 'space', { children: [], has_children: true });
    const partialSpace = makeView('space', WORKSPACE_ID, { extra: { is_space: true }, children: [partialFolder] });

    const remote: Record<string, View> = { page };
    const fetchView = jest.fn(async (_workspaceId: string, viewId: string) => remote[viewId] ?? null);

    const result = await resolveAncestorViewIds({
      selectedViewId: page.view_id,
      workspaceId: WORKSPACE_ID,
      outline: [partialSpace],
      fetchView,
    });

    expect(result).toEqual(['space', 'folder']);
    // Only `page` needs a fetch — folder and space resolve from the outline.
    expect(fetchView.mock.calls.map((c) => c[1])).toEqual(['page']);
  });

  it('returns null when the view cannot be resolved (fetch rejects)', async () => {
    const fetchView = jest.fn(async () => {
      throw new Error('403 forbidden');
    });

    const result = await resolveAncestorViewIds({
      selectedViewId: 'ghost',
      workspaceId: WORKSPACE_ID,
      outline: [],
      fetchView,
    });

    expect(result).toBeNull();
  });

  it('returns null when the remote fetch resolves to no view', async () => {
    const fetchView = jest.fn(async () => null);

    const result = await resolveAncestorViewIds({
      selectedViewId: 'ghost',
      workspaceId: WORKSPACE_ID,
      outline: [],
      fetchView,
    });

    expect(result).toBeNull();
  });

  it('stops at the workspace root and never includes it', async () => {
    const { space, folder, page } = buildTree();
    const fetchView = jest.fn(async () => null as View | null);

    const result = await resolveAncestorViewIds({
      selectedViewId: page.view_id,
      workspaceId: WORKSPACE_ID,
      outline: [space],
      fetchView,
    });

    expect(result).not.toContain(WORKSPACE_ID);
    // space's parent IS the workspace root, so the chain ends at space.
    expect(result?.[0]).toBe('space');
  });

  it('terminates on a parent_view_id cycle instead of looping forever', async () => {
    // a → b → a (a malformed cycle that never reaches the workspace root).
    const a = makeView('a', 'b');
    const b = makeView('b', 'a');

    const remote: Record<string, View> = { a, b };
    const fetchView = jest.fn(async (_workspaceId: string, viewId: string) => remote[viewId] ?? null);

    const result = await resolveAncestorViewIds({
      selectedViewId: 'a',
      workspaceId: WORKSPACE_ID,
      outline: [],
      fetchView,
    });

    // Walk: a→push b, b→push a, then a is already visited → stop.
    expect(result).toEqual(['a', 'b']);
    // Each node fetched exactly once thanks to the visited guard.
    expect(fetchView).toHaveBeenCalledTimes(2);
  });
});
