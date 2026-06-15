import { View, ViewLayout } from '@/application/types';

import { preserveLoadedChildren } from '../useWorkspaceData';

const createView = (viewId: string, overrides: Partial<View> = {}): View => ({
  view_id: viewId,
  name: overrides.name ?? viewId,
  icon: overrides.icon ?? null,
  layout: overrides.layout ?? ViewLayout.Document,
  extra: overrides.extra ?? null,
  children: overrides.children ?? [],
  has_children: overrides.has_children,
  is_published: overrides.is_published ?? false,
  is_private: overrides.is_private ?? false,
  ...overrides,
});

describe('preserveLoadedChildren', () => {
  it('does not restore stale children when server marks a node as empty', () => {
    const parentId = '11111111-1111-4111-8111-111111111111';
    const oldChild = createView('22222222-2222-4222-8222-222222222222');
    const oldOutline = [createView(parentId, { children: [oldChild], has_children: true })];
    const newOutline = [createView(parentId, { children: [], has_children: false })];

    const result = preserveLoadedChildren(newOutline, oldOutline, new Set([parentId]));

    expect(result.outline[0]?.children).toEqual([]);
    expect(result.loadedIds.has(parentId)).toBe(false);
  });

  it('restores previously loaded children when the node can still have children', () => {
    const parentId = '33333333-3333-4333-8333-333333333333';
    const oldChild = createView('44444444-4444-4444-8444-444444444444');
    const oldOutline = [createView(parentId, { children: [oldChild], has_children: true })];
    const newOutline = [createView(parentId, { children: [], has_children: true })];

    const result = preserveLoadedChildren(newOutline, oldOutline, new Set([parentId]));

    expect(result.outline[0]?.children.map((child) => child.view_id)).toEqual([oldChild.view_id]);
    expect(result.loadedIds.has(parentId)).toBe(true);
  });
});
