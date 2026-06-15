import { render, screen, waitFor } from '@testing-library/react';
import React, { useMemo, useState } from 'react';

import { View, ViewLayout } from '@/application/types';
import Outline from '@/components/app/outline/Outline';

declare global {
  // eslint-disable-next-line no-var
  var __outlineNavigationTestOutline: View[] | undefined;
  // eslint-disable-next-line no-var
  var __outlineNavigationTestSelectedViewId: string | undefined;
  // eslint-disable-next-line no-var
  var __outlineNavigationTestEnsureViewVisible: jest.Mock<Promise<string[]>, [viewId: string]> | undefined;
  // eslint-disable-next-line no-var
  var __outlineNavigationTestToView: jest.Mock<Promise<void>, [viewId: string]> | undefined;
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAIEnabled: () => true,
  useAppOperations: () => ({
    updatePage: jest.fn(),
    uploadFile: jest.fn(),
  }),
  useAppOutline: () => global.__outlineNavigationTestOutline,
  useCurrentWorkspaceId: () => 'workspace-id',
  useCurrentWorkspaceIdOptional: () => 'workspace-id',
  useEnsureViewVisibleInOutline: () => global.__outlineNavigationTestEnsureViewVisible,
  useLoadedViewIds: () => new Set<string>(),
  useLoadViewChildren: () => jest.fn().mockResolvedValue([]),
  useLoadViewChildrenBatch: () => jest.fn().mockResolvedValue([]),
  useMarkViewChildrenStale: () => jest.fn(),
  useRevalidateSidebarOutline: () => undefined,
  useSidebarHighlightedViewIds: () =>
    global.__outlineNavigationTestSelectedViewId ? [global.__outlineNavigationTestSelectedViewId] : [],
  useSidebarSelectedViewId: () => global.__outlineNavigationTestSelectedViewId,
  useToView: () => global.__outlineNavigationTestToView,
  useUserWorkspaceInfo: () => ({
    selectedWorkspace: {
      id: 'workspace-id',
      role: 'Owner',
    },
  }),
}));

jest.mock('@/components/app/favorite', () => ({
  Favorite: () => null,
}));

jest.mock('@/components/app/share-with-me', () => ({
  ShareWithMe: () => null,
}));

jest.mock('@/components/app/view-actions/ViewActionsPopover', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/app/import/ImportDialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/app/outline/AnimatedCollapse', () => ({
  __esModule: true,
  AnimatedCollapse: ({ expanded, children }: { expanded: boolean; children: React.ReactNode }) =>
    expanded ? <div>{children}</div> : null,
  default: ({ expanded, children }: { expanded: boolean; children: React.ReactNode }) =>
    expanded ? <div>{children}</div> : null,
}));

jest.mock('@/components/app/outline/reorder/useReorderableSidebarList', () => ({
  useReorderableSidebarList: ({ items }: { items: View[] }) => ({
    instanceId: Symbol('outline-navigation-test'),
    orderedItems: items,
  }),
}));

jest.mock('@/components/_shared/reorder/useReorderableItem', () => ({
  useReorderableItem: () => ({
    dragState: { type: 'idle' },
    shouldSuppressClick: () => false,
  }),
}));

jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/_shared/outline/OutlineIcon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/_shared/view-icon/SpaceIcon', () => ({
  __esModule: true,
  default: () => <span data-testid='space-icon' />,
}));

jest.mock('@/components/_shared/skeleton/DirectoryStructure', () => ({
  __esModule: true,
  default: () => <div data-testid='outline-skeleton' />,
}));

jest.mock('@/components/database/components/drag-and-drop/DropRowLine', () => ({
  __esModule: true,
  default: () => null,
}));

const spaceId = 'space-id';
const rootId = 'root-id';
const parentId = 'parent-id';
const targetId = 'target-id';
const rootSiblingId = 'root-sibling-id';
const targetSiblingId = 'target-sibling-id';

function createView(viewId: string, overrides: Partial<View> = {}): View {
  return {
    view_id: viewId,
    name: overrides.name ?? viewId,
    icon: overrides.icon ?? null,
    layout: overrides.layout ?? ViewLayout.Document,
    extra: overrides.extra ?? null,
    children: overrides.children ?? [],
    has_children: overrides.has_children,
    is_published: overrides.is_published ?? false,
    is_private: overrides.is_private ?? false,
    parent_view_id: overrides.parent_view_id,
    ...overrides,
  };
}

const shallowOutline = [
  createView(spaceId, {
    name: 'Space',
    extra: { is_space: true },
    has_children: true,
  }),
];

const hydratedOutline = [
  createView(spaceId, {
    name: 'Space',
    extra: { is_space: true },
    has_children: true,
    children: [
      createView(rootId, {
        name: 'Root view',
        has_children: true,
        parent_view_id: spaceId,
        children: [
          createView(parentId, {
            name: 'Parent view',
            has_children: true,
            parent_view_id: rootId,
            children: [
              createView(targetId, {
                name: 'Mention target',
                parent_view_id: parentId,
              }),
              createView(targetSiblingId, {
                name: 'Target sibling',
                parent_view_id: parentId,
              }),
            ],
          }),
        ],
      }),
      createView(rootSiblingId, {
        name: 'Root sibling',
        has_children: true,
        parent_view_id: spaceId,
      }),
    ],
  }),
];

function OutlineNavigationHarness({ ensureRejects = false }: { ensureRejects?: boolean }) {
  const [outline, setOutline] = useState<View[]>(shallowOutline);
  const ensureViewVisible = useMemo(
    () =>
      jest.fn(async (viewId: string) => {
        if (ensureRejects) {
          throw new Error('not enough permissions');
        }

        if (viewId === targetId) {
          setOutline(hydratedOutline);
          return [spaceId, rootId, parentId];
        }

        return [];
      }),
    [ensureRejects]
  );

  global.__outlineNavigationTestOutline = outline;
  global.__outlineNavigationTestEnsureViewVisible = ensureViewVisible;
  global.__outlineNavigationTestSelectedViewId = targetId;
  global.__outlineNavigationTestToView = jest.fn().mockResolvedValue(undefined);

  return <Outline width={280} />;
}

describe('Outline navigation context hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    global.__outlineNavigationTestOutline = undefined;
    global.__outlineNavigationTestEnsureViewVisible = undefined;
    global.__outlineNavigationTestSelectedViewId = undefined;
    global.__outlineNavigationTestToView = undefined;
  });

  it('hydrates and expands a notification target path when the selected view is missing locally', async () => {
    render(<OutlineNavigationHarness />);

    await waitFor(() => {
      expect(global.__outlineNavigationTestEnsureViewVisible).toHaveBeenCalledWith(targetId);
    });

    await waitFor(() => {
      expect(screen.getByText('Mention target')).toBeTruthy();
    });

    expect(screen.getByText('Parent view')).toBeTruthy();
    expect(screen.getByText('Target sibling')).toBeTruthy();
    expect(screen.getByText('Root sibling')).toBeTruthy();
    expect(screen.getByTestId(`page-${targetId}`).getAttribute('data-selected')).toBe('true');
    expect(JSON.parse(localStorage.getItem('outline_expanded') || '{}')).toEqual({
      [spaceId]: true,
      [rootId]: true,
      [parentId]: true,
    });
  });

  it('keeps the sidebar closed when navigation hydration denies access', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<OutlineNavigationHarness ensureRejects />);

    await waitFor(() => {
      expect(global.__outlineNavigationTestEnsureViewVisible).toHaveBeenCalledWith(targetId);
    });

    expect(screen.queryByText('Mention target')).toBeNull();
    expect(JSON.parse(localStorage.getItem('outline_expanded') || '{}')).toEqual({});

    warnSpy.mockRestore();
  });
});
