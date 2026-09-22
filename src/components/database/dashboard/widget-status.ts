import { DatabaseViewLayout } from '@/application/types';
import type { DatabaseDeletionStatus } from '@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus';

import type { WidgetPlaceholderReason } from './WidgetPlaceholder';

export type WidgetStatus = 'ready' | WidgetPlaceholderReason;

export interface WidgetStatusInput {
  /** The source database refused the viewer. */
  noAccess: boolean;
  /** Loading the source database failed for good. */
  loadFailed: boolean;
  /** Trash state of the source database (`null` while unknown). */
  deletionStatus: DatabaseDeletionStatus;
  /** The source doc arrived but still has no database after the grace period. */
  databaseMissing: boolean;
  /** The database is there but the referenced view is not, after the grace period. */
  viewMissing: boolean;
  hasDoc: boolean;
  hasDatabase: boolean;
  viewExists: boolean;
  layout: DatabaseViewLayout | null;
}

/**
 * What a widget shows. Access problems win over everything (they must never
 * reveal whether the view exists); a missing or trashed source is "not found";
 * anything not settled yet is "loading"; a view that became a dashboard is
 * not rendered (dashboards never nest).
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
}: WidgetStatusInput): WidgetStatus {
  if (noAccess) return 'no-access';
  if (loadFailed || deletionStatus === 'inTrash' || deletionStatus === 'deleted' || databaseMissing || viewMissing) {
    return 'not-found';
  }

  if (!hasDoc || !hasDatabase || !viewExists || deletionStatus === null) return 'loading';
  if (layout === DatabaseViewLayout.Dashboard) return 'unsupported';
  return 'ready';
}
