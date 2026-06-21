import { AccessLevel, View, ViewLayout } from '@/application/types';

import { mergeNavigationTreeIntoOutline, preserveLoadedChildren } from '../useWorkspaceData';

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

describe('mergeNavigationTreeIntoOutline', () => {
  it('hydrates the target path and preserves server sibling order', () => {
    const otherSpace = createView('99999999-9999-4999-8999-999999999999', {
      extra: { is_space: true },
    });
    const spaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rootId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const parentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const targetId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const siblingId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const rootSiblingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    const outline = [
      createView(spaceId, {
        extra: { is_space: true },
        children: [],
        has_children: true,
      }),
      otherSpace,
    ];
    const navigationTree = createView(spaceId, {
      extra: { is_space: true },
      children: [
        createView(rootId, {
          children: [
            createView(parentId, {
              children: [createView(targetId), createView(siblingId, { has_children: true })],
              has_children: true,
            }),
          ],
          has_children: true,
        }),
        createView(rootSiblingId, { has_children: true }),
      ],
      has_children: true,
    });

    const result = mergeNavigationTreeIntoOutline(outline, navigationTree, targetId, new Set());
    const hydratedSpace = result.find((view) => view.view_id === spaceId);
    const root = hydratedSpace?.children.find((view) => view.view_id === rootId);
    const parent = root?.children.find((view) => view.view_id === parentId);

    expect(result.map((view) => view.view_id)).toEqual([spaceId, otherSpace.view_id]);
    expect(hydratedSpace?.children.map((view) => view.view_id)).toEqual([rootId, rootSiblingId]);
    expect(parent?.children.map((view) => view.view_id)).toEqual([targetId, siblingId]);
  });

  it('keeps children for sibling branches already loaded locally', () => {
    const spaceId = '11111111-1111-4111-8111-111111111111';
    const rootId = '22222222-2222-4222-8222-222222222222';
    const loadedSiblingId = '33333333-3333-4333-8333-333333333333';
    const loadedSiblingChild = createView('44444444-4444-4444-8444-444444444444');
    const targetId = '55555555-5555-4555-8555-555555555555';

    const outline = [
      createView(spaceId, {
        extra: { is_space: true },
        children: [
          createView(rootId),
          createView(loadedSiblingId, {
            children: [loadedSiblingChild],
            has_children: true,
          }),
        ],
      }),
    ];
    const navigationTree = createView(spaceId, {
      extra: { is_space: true },
      children: [
        createView(rootId, {
          children: [createView(targetId)],
          has_children: true,
        }),
        createView(loadedSiblingId, {
          children: [],
          has_children: true,
        }),
      ],
    });

    const result = mergeNavigationTreeIntoOutline(outline, navigationTree, targetId, new Set([loadedSiblingId]));
    const loadedSibling = result[0]?.children.find((view) => view.view_id === loadedSiblingId);

    expect(loadedSibling?.children.map((view) => view.view_id)).toEqual([loadedSiblingChild.view_id]);
  });

  it('attaches a shared private navigation root under the hidden shared-with-me space', () => {
    const workspaceSpace = createView('66666666-6666-4666-8666-666666666666', {
      extra: { is_space: true },
    });
    const sharedSpaceId = '77777777-7777-4777-8777-777777777777';
    const sharedRootId = '88888888-8888-4888-8888-888888888888';
    const targetId = '99999999-9999-4999-8999-999999999999';
    const sharedWithMe = createView(sharedSpaceId, {
      extra: {
        is_space: true,
        is_hidden_space: true,
      },
      children: [],
      has_children: true,
    });
    const navigationTree = createView(sharedRootId, {
      access_level: AccessLevel.ReadOnly,
      is_private: true,
      children: [createView(targetId)],
    });

    const result = mergeNavigationTreeIntoOutline([workspaceSpace, sharedWithMe], navigationTree, targetId, new Set());
    const updatedSharedWithMe = result.find((view) => view.view_id === sharedSpaceId);

    expect(result.map((view) => view.view_id)).toEqual([workspaceSpace.view_id, sharedSpaceId]);
    expect(updatedSharedWithMe?.children.map((view) => view.view_id)).toEqual([sharedRootId]);
  });
});
