export type SyncStatus = 'checking' | 'syncing' | 'synced' | 'offline' | 'error';

interface Counts {
  pending: number;
  accepted: number;
  errors: number;
}

const counts = new Map<string, Counts>();
const parents = new Map<string, string>();
const aliases = new Map<string, string>();
const ready = new Set<string>();
const listeners = new Set<() => void>();
let connected = false;
let discovered = false;
let notificationQueued = false;

function notify() {
  if (notificationQueued) return;
  notificationQueued = true;
  queueMicrotask(() => {
    notificationQueued = false;
    listeners.forEach((listener) => listener());
  });
}

/** Update only the edited object and its ancestors, never scan a database's rows. */
export function changeSyncCounts(objectId: string, pending: number, accepted: number, errors = 0) {
  const visited = new Set<string>();
  let id: string | undefined = objectId;

  while (id && !visited.has(id)) {
    visited.add(id);
    const current = counts.get(id) ?? { pending: 0, accepted: 0, errors: 0 };

    counts.set(id, {
      pending: current.pending + pending,
      accepted: current.accepted + accepted,
      errors: current.errors + errors,
    });
    id = parents.get(id);
  }

  notify();
}

/** Attach a row or row document without opening any additional collabs. */
export function setSyncParent(objectId: string, parentId: string) {
  if (!parentId || objectId === parentId || parents.get(objectId) === parentId) return;
  let ancestor: string | undefined = parentId;

  while (ancestor) {
    if (ancestor === objectId) return;
    ancestor = parents.get(ancestor);
  }

  const previous = parents.get(objectId);
  const total = counts.get(objectId);

  if (previous && total) changeSyncCounts(previous, -total.pending, -total.accepted, -total.errors);
  parents.set(objectId, parentId);
  if (total) changeSyncCounts(parentId, total.pending, total.accepted, total.errors);
  notify();
}

export function syncAncestors(objectId: string): string[] {
  const result: string[] = [];
  let parent = parents.get(objectId);

  while (parent) {
    result.push(parent);
    parent = parents.get(parent);
  }

  return result;
}

export function setSyncAlias(viewId: string, objectId: string) {
  if (aliases.get(viewId) === objectId) return;
  aliases.set(viewId, objectId);
  notify();
}

export function markSyncReady(objectId: string) {
  if (ready.has(objectId)) return;
  ready.add(objectId);
  notify();
}

export function setSyncConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  notify();
}

export function markSyncDiscovered() {
  discovered = true;
  notify();
}

export function resetSyncStatus() {
  counts.clear();
  parents.clear();
  aliases.clear();
  ready.clear();
  discovered = false;
  // `connected` mirrors the shared socket, which a session reset does not close.
  notify();
}

export function subscribeSyncStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Only expose unsettled edits; startup checks and accepted edits awaiting a snapshot stay quiet. */
export function getPendingSyncStatus(viewId: string): 'syncing' | 'offline' | 'error' | null {
  const total = counts.get(aliases.get(viewId) ?? viewId);

  if (total?.errors) return 'error';
  if (!total || total.pending <= total.accepted) return null;
  return connected ? 'syncing' : 'offline';
}

export function getSyncStatus(viewId: string): SyncStatus {
  const objectId = aliases.get(viewId) ?? viewId;
  const total = counts.get(objectId);

  if (total?.errors) return 'error';
  if (!connected) return 'offline';
  // The header tracks server acceptance. Accepted edits remain pending internally until the
  // Worker's saved receipt allows their local recovery copies to be removed.
  if (total?.pending && total.accepted !== total.pending) return 'syncing';
  return discovered && ready.has(objectId) ? 'synced' : 'checking';
}
