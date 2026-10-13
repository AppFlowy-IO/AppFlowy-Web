import { v4 as uuidv4 } from 'uuid';

import { db } from '@/application/db';
import { SyncPermissionBlock } from '@/application/db/tables/sync_outbox';

type Scope = { serverUrl?: string; userId: string; workspaceId: string };

export function permissionBlockKey(scope: Scope, objectId: string): [string, string, string, string] {
  return [scope.serverUrl ?? '', scope.userId, scope.workspaceId, objectId];
}

/** A durable object fence also protects future manifest reconstruction. */
export async function readPermissionBlock(scope: Scope, objectId: string) {
  return db.sync_permission_blocks.get(permissionBlockKey(scope, objectId));
}

/**
 * A new denial gets a new revision, so a retry that reviewed an older one cannot
 * release it. A re-check confirming the same quarantine keeps the revision.
 */
export async function persistPermissionBlock(
  scope: Scope, objectId: string, options: { keepExistingRevision?: boolean } = {}
): Promise<void> {
  await db.transaction('rw', db.sync_outbox, db.sync_permission_blocks, async () => {
    const existing = options.keepExistingRevision ? await readPermissionBlock(scope, objectId) : undefined;

    if (!existing) {
      await db.sync_permission_blocks.put({
        userId: scope.userId, workspaceId: scope.workspaceId,
        serverUrl: scope.serverUrl ?? '', objectId, revision: uuidv4(),
      });
    }

    await db.sync_outbox.where('[userId+workspaceId+objectId]').equals([scope.userId, scope.workspaceId, objectId])
      .filter((record) => record.serverUrl === scope.serverUrl).modify({ permissionBlocked: true });
  });
}

/** Release only the denial and exact byte records explicitly reviewed by this retry. */
export async function releasePermissionBlock(
  scope: Scope, objectId: string, block: SyncPermissionBlock | undefined, throughId: number, isCurrent: () => boolean
): Promise<boolean> {
  return db.transaction('rw', db.sync_outbox, db.sync_permission_blocks, async () => {
    const current = await readPermissionBlock(scope, objectId);

    if (!isCurrent() || current?.revision !== block?.revision) return false;
    await db.sync_outbox.where('[userId+workspaceId+objectId]').equals([scope.userId, scope.workspaceId, objectId])
      .filter((record) => record.serverUrl === scope.serverUrl && record.id !== undefined && record.id <= throughId)
      .modify({ permissionBlocked: false });
    if (!isCurrent()) return false;
    await db.sync_permission_blocks.delete(permissionBlockKey(scope, objectId));
    return true;
  });
}
