import dayjs from 'dayjs';

import { User, YDatabaseRow, YjsDatabaseKey } from '@/application/types';
import { canonicalizeUserUid, UserUid } from '@/application/user-uid';

export type AttributionUid = UserUid;

/**
 * Convert API and collab user IDs to the lossless primitive stored in rows.
 */
export function normalizeAttributionUid(uid: AttributionUid): string | null {
  return canonicalizeUserUid(uid);
}

/** Resolve only the exact actor UID supplied by the current profile response. */
export function resolveUserAttributionUid(
  user: Pick<User, 'uid' | 'attributionUid'> | null | undefined
): string | null {
  if (!user) return null;

  return normalizeAttributionUid(user.attributionUid);
}

/** Initialize immutable creator and current-editor metadata for a new row. */
export function initializeRowAttribution(row: YDatabaseRow, uid: AttributionUid): void {
  const actorUid = normalizeAttributionUid(uid);

  if (actorUid === null) return;

  row.set(YjsDatabaseKey.created_by, actorUid);
  row.set(YjsDatabaseKey.last_edited_by, actorUid);
}

/** Update the row's last-touch timestamp and editor in the caller's transaction. */
export function touchRowAttribution(
  row: YDatabaseRow,
  uid: AttributionUid,
  timestamp = String(dayjs().unix())
): void {
  row.set(YjsDatabaseKey.last_modified, timestamp);

  const actorUid = normalizeAttributionUid(uid);

  if (actorUid !== null) {
    row.set(YjsDatabaseKey.last_edited_by, actorUid);
  }
}
