
import { db } from '@/application/db';
import { getCollabVersions } from '@/application/services/js-services/http/http_api';

interface DeleteItem {
  clock: number;
  len: number;
}

export interface CollabVersion {
  versionId: string,
  parentId: string | null,
  name: string | null,
  createdAt: Date,
  snapshot: Uint8Array | null,
  uids?: string[]
}

/**
 * By default, invalidate versions stored in IndexedDb cache after 30 days.
 */
const VERSION_EXPIRY_DAYS = 7;

const cleanupExpiredVersions = async (versions: Map<string, CollabVersion>) => {
  const expirationDate = Date.now() - (VERSION_EXPIRY_DAYS * 1000 * 60 * 60 * 24);
  const toDelete = [];

  for (const [versionId, version] of versions) {
    if (version.createdAt.getTime() < expirationDate) {
      toDelete.push(versionId);
    }
  }

  if (toDelete.length > 0) {
    console.debug('Pruning expired collab versions', toDelete);
    await db.collab_versions.bulkDelete(toDelete);
  }
};

/**
 * Returns the collab versions for a given `viewId`. These are fetched from remote HTTP endpoint and cached inside
 * IndexedDB store.
 *
 * @param workspaceId current workspace UUID.
 * @param viewId view UUID.
 * @param users (optional) information mapping used to correlate session id changes with appflowy user IDs. If provided
 *              it will let collab versions fill the information about which users made changes between specific version
 *              and its predecessor.
 */
export const collabVersions = async (workspaceId: string, viewId: string) => {
  //TODO: join editors with user data (preferably cached locally)
  await getCollabVersions(workspaceId, viewId)
}