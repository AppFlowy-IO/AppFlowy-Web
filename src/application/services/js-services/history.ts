
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
  isDeleted: boolean,
  uids?: string[]
}

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