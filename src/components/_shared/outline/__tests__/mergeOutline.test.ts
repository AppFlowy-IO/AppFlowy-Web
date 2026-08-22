import { View, ViewLayout } from '@/application/types';
import { mergeShallowChildrenIntoOutline } from '@/components/_shared/outline/mergeOutline';

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

describe('mergeShallowChildrenIntoOutline', () => {
  it('updates direct children while preserving hydrated descendants beyond the response depth', () => {
    const activeTab = createView('active-tab');
    const databaseContainer = createView('database-container', {
      children: [activeTab],
      has_children: true,
      name: 'Old database name',
    });
    const outline = [
      createView('space', {
        children: [databaseContainer, createView('removed-page')],
        has_children: true,
      }),
    ];
    const shallowChildren = [
      createView('database-container', {
        children: [],
        has_children: true,
        name: 'Updated database name',
      }),
      createView('new-page'),
    ];

    const result = mergeShallowChildrenIntoOutline(outline, 'space', shallowChildren, true);
    const space = result[0];
    const container = space?.children[0];

    expect(space?.children.map((view) => view.view_id)).toEqual(['database-container', 'new-page']);
    expect(container?.name).toBe('Updated database name');
    expect(container?.children.map((view) => view.view_id)).toEqual(['active-tab']);
  });

  it('clears hydrated descendants when the response explicitly marks the child as empty', () => {
    const outline = [
      createView('space', {
        children: [
          createView('page', {
            children: [createView('stale-child')],
            has_children: true,
          }),
        ],
        has_children: true,
      }),
    ];
    const shallowChildren = [createView('page', { children: [], has_children: false })];

    const result = mergeShallowChildrenIntoOutline(outline, 'space', shallowChildren, true);

    expect(result[0]?.children[0]?.children).toEqual([]);
    expect(result[0]?.children[0]?.has_children).toBe(false);
  });
});
