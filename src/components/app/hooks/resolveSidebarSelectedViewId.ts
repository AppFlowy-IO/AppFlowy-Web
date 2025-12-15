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

