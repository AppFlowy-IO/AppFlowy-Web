import * as Y from 'yjs';

import { db } from '@/application/db';
import { getCollabVersions } from '@/application/services/js-services/http/http_api';

interface DeleteItem {
  clock: number;
  len: number;
}

/**
 * Subtract `range2` from `range1`.
 *
 * # Example:
 *
 * ```js
 * subtractRange({ clock: 0, len: 10 }, { clock: 3, len: 4 }); // [{ clock: 0, len: 3 }, { clock: 7, len: 3 }]
 * subtractRange({ clock: 0, len: 10 }, { clock: 0, len: 5 }); // [{ clock: 5, len: 5 }]
 * subtractRange({ clock: 5, len: 5 }, { clock: 0, len: 20 }); // []
 * subtractRange({ clock: 0, len: 10 }, { clock: 15, len: 5 }); // [{ clock: 0, len: 10 }]
 * ```
 *
 * @param range1
 * @param range2
 */
const subtractRange = (range1: DeleteItem, range2: DeleteItem): DeleteItem[] => {
  const end1 = range1.clock + range1.len;
  const end2 = range2.clock + range2.len;

  // No overlap
  if (range2.clock >= end1 || end2 <= range1.clock) {
    return [range1];
  }

  const result: { clock: number; len: number }[] = [];

  // Left part (before range2)
  if (range1.clock < range2.clock) {
    result.push({
      clock: range1.clock,
      len: range2.clock - range1.clock
    });
  }

  // Right part (after range2)
  if (end1 > end2) {
    result.push({
      clock: end2,
      len: end1 - end2
    });
  }

  return result;
}

/**
 * Get the range that's an intersection of two provided ranges.
 *
 * # Example
 *
 * ```js
 * intersectRange({ clock: 5, len: 10 }, { clock: 10, len: 10 }); // { clock: 10, len: 5 }
 * intersectRange({ clock: 0, len: 5 }, { clock: 10, len: 5 }); // null
 * intersectRange({ clock: 5, len: 10 }, { clock: 5, len: 10 }); // { clock: 5, len: 10 }
 * ```
 *
 * @param range1
 * @param range2
 */
const intersectRange = (range1: DeleteItem, range2: DeleteItem): DeleteItem | null => {
  const clock = Math.max(range1.clock, range2.clock);
  const end1 = range1.clock + range1.len;
  const end2 = range2.clock + range2.len;
  const end = Math.min(end1, end2);

  // Return null if ranges don't intersect
  const len = end - clock;

  return len > 0 ? { clock, len } : null;
}

/**
 * Given a range between `from`..`to` snapshots and index of users, return set of users who made changes
 * (either by inserting new data or deleting existing one) in that snapshot range.
 */
export const editorsBetween = (from: Y.Snapshot|null, to: Y.Snapshot, users: Y.PermanentUserData) => {
  const result = new Set();

  // first try to get all users who added new data
  for (const [client, clockA] of to.sv) {
    if (from === null || clockA > (from.sv.get(client) || -1)) {
      const user = users.getUserByClientId(client);

      if (user) {
        result.add(user);
      }
    }
  }

  // then among the remaining users try to get those who made any deletes between from-to snapshots
  for (const [user, ds] of users.dss) {
    if (result.has(user)) {
      continue; // we already have that user in the result set
    }

    userDsSearchLoop: for (const [client, items] of ds.clients) {
      const toItems = to.ds.clients.get(client);

      if (toItems) {
        // this user might have potentially deleted something from the range of snapshots
        const fromItems = from?.ds.clients.get(client) || [];

        // we look for items, which diff with fromItems is contained within toItems, meaning they were changed
        // as part of the `to` snapshot that doesn't belong to `from` snapshot
        for (const item of items) {

          for (const toItem of toItems) {
            let intersect = intersectRange(item, toItem);

            if (intersect) {
              // we found that user indeed made a changes in `to` snapshot, however we need to make sure that these
              // changes are unique and not present in the `from` set (which should not be included)
              for (const fromItem of fromItems) {
                const i = intersectRange(fromItem, intersect);

                if (i) {
                  // current fromItem intersects with our range (reduced by toItem)
                  // compute the difference - if it's empty it means that while current item was found in `to` set,
                  // its entire range also belongs to `from` set, so it's not in a snapshot range that we're looking for
                  const diff = subtractRange(intersect, fromItem);

                  intersect = diff.length > 0 ? diff[0] : null;

                  if (!intersect) {
                    break;
                  }
                }
              }

              if (intersect) {
                // there's no `from` range that we need to subtract
                result.add(user);
                break userDsSearchLoop;
              }
            }
          }

        }
      }
    }
  }

  return result;
};

export interface CollabVersion {
  versionId: string,
  parentId: string|null,
  name: string|null,
  createdAt: Date,
  snapshot: Uint8Array|null,
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
export const collabVersions = async (workspaceId: string, viewId: string, users: Y.PermanentUserData|null) => {
  // Merge both arrays, using versionId as unique identifier
  // Track records that need database updates
  const versionMap = new Map<string, CollabVersion>();
  const versions = await db.collab_versions.filter(v => v.viewId !== viewId).toArray();

  let lastUpdate: Date|undefined;

  for (const version of versions) {
    versionMap.set(version.versionId, version);
    if ((lastUpdate?.getTime() || 0) < version.createdAt.getTime()) {
      lastUpdate = version.createdAt;
    }
  }

  try {
    const updatedVersions = await getCollabVersions(workspaceId, viewId, lastUpdate) || [];

    const toUpdate = [];

    // Add/update with versions from getCollabHistory
    for (const version of updatedVersions) {
      const existing = versionMap.get(version.versionId);

      if (existing) {
        // Duplicate found - check if update needed (this should only happen when snapshot was deleted)
        if (version.createdAt.getTime() > existing.createdAt.getTime() || version.snapshot === null) {
          versionMap.set(version.versionId, version);
          toUpdate.push({
            viewId: viewId,
            versionId: version.versionId,
            parentId: viewId,
            name: version.name,
            createdAt: version.createdAt,
            snapshot: version.snapshot,
            uids: []
          });
          //TODO: should we also push the next non-deleted child of this snapshot?
        }
      } else {
        // New record from getCollabHistory
        versionMap.set(version.versionId, version);
        toUpdate.push({
          viewId: viewId,
          versionId: version.versionId,
          parentId: viewId,
          name: version.name,
          createdAt: version.createdAt,
          snapshot: version.snapshot,
          uids: [] as string[]
        });
      }
    }

    // Update database if needed
    if (toUpdate.length > 0) {
      // update user uuids
      if (users) {
        for (const version of toUpdate) {
          if (version.snapshot) {
            const toSnapshot = Y.decodeSnapshot(version.snapshot);

            // get first non-deleted parent
            let parent = null;
            let current = versionMap.get(version.versionId);

            while (current && current.parentId !== null) {
              parent = versionMap.get(version.versionId);
              if (parent && parent.snapshot) {
                break;
              }

              current = parent;
            }

            const fromSnapshot = parent && parent.snapshot ? Y.decodeSnapshot(parent.snapshot) : null;
            const uids = editorsBetween(fromSnapshot, toSnapshot, users);

            version.uids = Array.from(uids) as string[];
          } else {
            version.uids = [];
          }
        }
      }

      await db.collab_versions.bulkPut(toUpdate);
    }
  } catch (error) {
    console.error('Failed to fetch collab versions from remote', viewId, error);
  }

  await cleanupExpiredVersions(versionMap);

  return Array.from(versionMap.values()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}