import { lazy } from 'react';

import { getWorkspaceDatabaseCatalog } from '@/application/services/domains/view';
import { UIVariant } from '@/application/types';

// The dock (the "New view" picker, the New view panel and the Source panel)
// only loads once an editor reaches for it: viewers and published dashboards
// never load it.
const loadWidgetDockHost = () => import('./add-widget/WidgetDockHost');

/** The add flow's dock, loaded on demand (`WidgetDockHost`). */
export const LazyWidgetDockHost = lazy(loadWidgetDockHost);

/**
 * Fetch the dock's code, and the workspace catalog its "Other data sources"
 * lists, ahead of a click (on hover / focus of an add button). The picker then
 * reads the catalog snapshot or joins the request in flight instead of
 * starting its own; a published dashboard's picker never loads the catalog.
 * The add flow warms the workspace plan beside it (`useAddWidgetFlow`).
 */
export function preloadWidgetPicker(workspaceId: string | undefined, variant: UIVariant | undefined) {
  void loadWidgetDockHost();
  // A failure is left to the picker, which retries and shows it.
  if (workspaceId && variant !== UIVariant.Publish) void getWorkspaceDatabaseCatalog(workspaceId).catch(() => undefined);
}
