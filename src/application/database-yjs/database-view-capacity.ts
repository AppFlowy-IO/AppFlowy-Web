import { t } from 'i18next';
import { validate as isUuid, v5 as uuidv5 } from 'uuid';

import { YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { getMaxDashboardWidgets } from '@/utils/server-info';

/** Count usable views, including hidden/embedded/primary views. Only the canonical storage view is exempt. */
export function getDatabaseViewCount(databaseDoc: YDoc | undefined): number {
  const database = databaseDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);
  const objectId = databaseDoc?.object_id ?? databaseDoc?.guid;
  // Match collab's database_inline_view_id. Flags and metas.iid are mutable,
  // so neither can grant another usable view an exemption from the server cap.
  const internalViewId = objectId && isUuid(objectId) ? uuidv5('inline_view_id', objectId) : undefined;

  return (views?.size ?? 0) - (internalViewId && views?.has(internalViewId) ? 1 : 0);
}

export function databaseViewLimitMessage(limit = getMaxDashboardWidgets()): string {
  const fallback = `This database has reached its limit of ${limit} views. Remove a view before creating another.`;

  return t('databaseViewCreation.viewLimitReached', { limit, defaultValue: fallback }) || fallback;
}

/** Execution-time preflight; the server remains authoritative for concurrent or unseen creates. */
export function assertDatabaseViewCapacity(databaseDoc: YDoc | undefined): void {
  const limit = getMaxDashboardWidgets();

  if (getDatabaseViewCount(databaseDoc) >= limit) throw new Error(databaseViewLimitMessage(limit));
}
