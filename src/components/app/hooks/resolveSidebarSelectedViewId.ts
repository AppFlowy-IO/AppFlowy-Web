import { View } from '@/application/types';
import { isDatabaseContainer, isDatabaseLayout } from '@/application/view-utils';
import { findView } from '@/components/_shared/outline/utils';

export const DATABASE_TAB_VIEW_ID_QUERY_PARAM = 'v';

export function resolveSidebarSelectedViewId(params: {
  routeViewId?: string;
  tabViewId?: string | null;
  outline?: View[];
}): string | undefined {
  const { routeViewId, tabViewId, outline } = params;

  if (!routeViewId) return undefined;
  if (!tabViewId || tabViewId === routeViewId) return routeViewId;
  if (!outline) return routeViewId;

  const routeView = findView(outline, routeViewId);
  const tabView = findView(outline, tabViewId);

  if (!routeView || !tabView) return routeViewId;

  const routeIsDatabase = isDatabaseLayout(routeView.layout) || isDatabaseContainer(routeView);
  const tabIsDatabase = isDatabaseLayout(tabView.layout);

  if (!routeIsDatabase || !tabIsDatabase) return routeViewId;

  const containerId = isDatabaseContainer(routeView) ? routeView.view_id : routeView.parent_view_id;

  if (!containerId) return routeViewId;

  return tabView.parent_view_id === containerId || tabView.view_id === containerId ? tabViewId : routeViewId;
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

  const selectedView = outline ? findView(outline, selectedViewId) : undefined;
  const outlineParent = selectedView?.parent_view_id && outline ? findView(outline, selectedView.parent_view_id) : undefined;

  if (outlineParent && isDatabaseContainer(outlineParent)) {
    highlightedViewIds.add(outlineParent.view_id);
  }

  return Array.from(highlightedViewIds);
}
