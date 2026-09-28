import { DatabaseViewLayout } from '@/application/types';
import type { DatabaseDeletionStatus } from '@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus';

import type { WidgetPlaceholderReason } from './WidgetPlaceholder';

export type WidgetStatus = 'ready' | WidgetPlaceholderReason;

export interface WidgetStatusInput {
  /** The source database refused the viewer. */
  noAccess: boolean;
  /** Loading the source database failed for good. */
  loadFailed: boolean;
  /** Trash state of the source database (`null` while the probe runs). */
  deletionStatus: DatabaseDeletionStatus;
  /** The source doc arrived but still has no database after the grace period. */
  databaseMissing: boolean;
  /** The database is there but the referenced view is not, after the grace period. */
  viewMissing: boolean;
  hasDoc: boolean;
  hasDatabase: boolean;
  viewExists: boolean;
  layout: DatabaseViewLayout | null;
  /** The widget remounted (moved to another row) and starts from the doc it showed as ready. */
  seeded: boolean;
}

/**
 * What a widget shows. Access problems win over everything (they must never
 * reveal whether the view exists); a missing or trashed source is "not found";
 * anything not settled yet is "loading"; a view that became a dashboard is
 * not rendered (dashboards never nest). A remounted widget does not wait for
 * the trash probe again before showing what it already showed: it swaps to
 * "not found" only once the probe confirms the trash.
 *
 * Access is what the widget's own load reports. Views of one database share
 * its access on this client (see the view loader's `fetchViewFromServer`): a
 * view whose database another widget already loaded renders even where its own
 * request would have been refused.
 */
export function getWidgetStatus({
  noAccess,
  loadFailed,
  deletionStatus,
  databaseMissing,
  viewMissing,
  hasDoc,
  hasDatabase,
  viewExists,
  layout,
  seeded,
}: WidgetStatusInput): WidgetStatus {
  if (noAccess) return 'no-access';
  if (loadFailed || deletionStatus === 'inTrash' || deletionStatus === 'deleted' || databaseMissing || viewMissing) {
    return 'not-found';
  }

  if (!hasDoc || !hasDatabase || !viewExists || (deletionStatus === null && !seeded)) return 'loading';
  if (layout === DatabaseViewLayout.Dashboard) return 'unsupported';
  return 'ready';
}
