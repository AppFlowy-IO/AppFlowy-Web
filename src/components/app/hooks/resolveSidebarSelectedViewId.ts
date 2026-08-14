import { View } from '@/application/types';
import { getFirstChildView, isDatabaseContainer, isDatabaseLayout } from '@/application/view-utils';

export const DATABASE_TAB_VIEW_ID_QUERY_PARAM = 'v';

interface OutlineIndex {
  parentById: Map<string, View>;
  viewById: Map<string, View>;
}

// Outline updates replace the root array, so a weak cache keeps recursive item
// lookups O(1) without retaining outlines that are no longer rendered.
const outlineIndexCache = new WeakMap<View[], OutlineIndex>();

function getOutlineIndex(outline: View[]): OutlineIndex {
  const cached = outlineIndexCache.get(outline);

  if (cached) return cached;

  const parentById = new Map<string, View>();
  const viewById = new Map<string, View>();
  const stack: Array<{ parent?: View; view: View }> = [];

  for (let index = outline.length - 1; index >= 0; index -= 1) {
    stack.push({ view: outline[index] });
  }

  while (stack.length > 0) {
    const entry = stack.pop();

    if (!entry || viewById.has(entry.view.view_id)) continue;

    viewById.set(entry.view.view_id, entry.view);
    if (entry.parent) parentById.set(entry.view.view_id, entry.parent);

    for (let index = entry.view.children.length - 1; index >= 0; index -= 1) {
      stack.push({ parent: entry.view, view: entry.view.children[index] });
    }
  }

  const outlineIndex = { parentById, viewById };

  outlineIndexCache.set(outline, outlineIndex);
  return outlineIndex;
}

export function resolveSidebarSelectedViewId(params: {
  routeViewId?: string;
  tabViewId?: string | null;
  outline?: View[];
}): string | undefined {
  const { routeViewId, tabViewId, outline } = params;

  if (!routeViewId) return undefined;
  if (!outline) return routeViewId;

  const { parentById, viewById } = getOutlineIndex(outline);
  const routeView = viewById.get(routeViewId);

  if (!routeView) return routeViewId;

  const defaultViewId = getFirstChildView(routeView)?.view_id ?? routeViewId;

  if (!tabViewId || tabViewId === routeViewId) return defaultViewId;

  const tabView = viewById.get(tabViewId);

  if (!tabView) return defaultViewId;

  const routeIsDatabase = isDatabaseLayout(routeView.layout) || isDatabaseContainer(routeView);
  const tabIsDatabase = isDatabaseLayout(tabView.layout);

  if (!routeIsDatabase || !tabIsDatabase) return defaultViewId;

  const routeParent = parentById.get(routeView.view_id);
  const containerId = isDatabaseContainer(routeView)
    ? routeView.view_id
    : isDatabaseContainer(routeParent)
      ? routeParent.view_id
      : routeView.parent_view_id;

  if (!containerId) return defaultViewId;

  const tabParent = parentById.get(tabView.view_id);
  const tabBelongsToContainer =
    tabView.parent_view_id === containerId || tabParent?.view_id === containerId || tabView.view_id === containerId;

  return tabBelongsToContainer ? tabViewId : defaultViewId;
}

export function resolveSidebarHighlightedViewIds(params: {
  routeViewId?: string;
  tabViewId?: string | null;
  outline?: View[];
  breadcrumbs?: View[];
}): string[] {
  const selectedViewId = resolveSidebarSelectedViewId(params);

  if (!selectedViewId) return [];

  const highlightedViewIds = new Set<string>([selectedViewId]);

  const { outline, breadcrumbs } = params;
  const selectedIndex = breadcrumbs?.findIndex((view) => view.view_id === selectedViewId) ?? -1;
  const breadcrumbParent = selectedIndex > 0 ? breadcrumbs?.[selectedIndex - 1] : undefined;

  if (breadcrumbParent && isDatabaseContainer(breadcrumbParent)) {
    highlightedViewIds.add(breadcrumbParent.view_id);
    return Array.from(highlightedViewIds);
  }

  const outlineIndex = outline ? getOutlineIndex(outline) : undefined;
  const selectedView = outlineIndex?.viewById.get(selectedViewId);
  const outlineParent =
    outlineIndex?.parentById.get(selectedViewId) ||
    (selectedView?.parent_view_id ? outlineIndex?.viewById.get(selectedView.parent_view_id) : undefined);

  if (outlineParent && isDatabaseContainer(outlineParent)) {
    highlightedViewIds.add(outlineParent.view_id);
  }

  return Array.from(highlightedViewIds);
}
