import { getTokenParsed } from '@/application/session/token-storage';
import { getConfigValue } from '@/utils/runtime-config';

const STORAGE_PREFIX = 'af_collab:v2:';

type WorkspaceScope = { serverUrl: string; userId: string; workspaceId: string };
let workspace: WorkspaceScope | null = null;
let lastScopeKey: string | undefined;
let generation = 0;
const documentScopes = new WeakMap<object, CollabStorageScope>();

/** The workspace comes from the mounted sync layer, never from a stale persisted route. */
export function setCollabStorageWorkspace(next: WorkspaceScope | null): void {
  workspace = next;
  currentScopeKey();
}

function currentScopeKey(): string {
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const userId = getTokenParsed()?.user.id ?? null;
  const workspaceId = workspace?.serverUrl === serverUrl && workspace?.userId === userId
    ? workspace.workspaceId : null;

  const key = JSON.stringify([serverUrl, userId, workspaceId]);

  if (key !== lastScopeKey) {
    lastScopeKey = key;
    generation += 1;
  }

  return key;
}

export type CollabStorageScope = {
  key: string;
  generation: number;
  storageKey: (objectId: string) => string;
  isCurrent: () => boolean;
  assertCurrent: () => void;
};

/**
 * Unknown-origin legacy bytes are never adopted into this namespace. Canonical
 * object IDs remain unchanged on Y.Docs and on the wire; only local storage and
 * memory caches carry the server/account/workspace identity.
 */
export function captureCollabStorageScope(): CollabStorageScope {
  const key = currentScopeKey();
  const capturedGeneration = generation;
  const isCurrent = () => currentScopeKey() === key && generation === capturedGeneration;

  return {
    key,
    generation: capturedGeneration,
    storageKey: (objectId) => `${STORAGE_PREFIX}${key}:${objectId}`,
    isCurrent,
    assertCurrent: () => {
      if (!isCurrent()) throw new Error('The collaboration storage context changed');
    },
  };
}

/** Account-keyed metadata caches also need an origin, before a workspace mounts. */
export function serverScopedAccountKey(userId: string): string {
  return JSON.stringify([getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), userId]);
}

/** Every collab storage name of one account on one server starts with this, whatever the workspace. */
export function accountCollabStoragePrefix(serverUrl: string, userId: string): string {
  return `${STORAGE_PREFIX}${JSON.stringify([serverUrl, userId]).slice(0, -1)},`;
}

/** Storage written before names carried a server/account/workspace scope. */
export function isPreScopeCollabStorageName(name: string): boolean {
  return !name.startsWith(STORAGE_PREFIX) && /^[0-9a-f]{8}-[0-9a-f-]{27}(?:$|[:_])/i.test(name);
}

export const COLLAB_STORAGE_PREFIX = STORAGE_PREFIX;

export function collabStorageKey(objectId: string): string {
  return captureCollabStorageScope().storageKey(objectId);
}

export function bindCollabStorageScope(doc: object, scope: CollabStorageScope): void {
  documentScopes.set(doc, scope);
}

export function isCollabStorageCurrent(doc: object): boolean {
  return documentScopes.get(doc)?.isCurrent() ?? true;
}

export function assertCollabStorageCurrent(doc: object): void {
  documentScopes.get(doc)?.assertCurrent();
}

/** Partition caches while allowing async callers to retain their original map. */
export class ScopedCollabMap<V> {
  private identity?: string;
  private map = new Map<string, V>();

  constructor(private readonly retire?: (entries: Map<string, V>) => void) {}

  capture(): Map<string, V> {
    const key = `${currentScopeKey()}:${generation}`;

    if (key !== this.identity) {
      const previous = this.map;

      this.identity = key;
      this.map = new Map();
      this.retire?.(previous);
    }

    return this.map;
  }

  get size() { return this.capture().size; }
  get(key: string) { return this.capture().get(key); }
  has(key: string) { return this.capture().has(key); }
  set(key: string, value: V) { this.capture().set(key, value); return this; }
  delete(key: string) { return this.capture().delete(key); }
  clear() { this.capture().clear(); }
  keys() { return this.capture().keys(); }
  values() { return this.capture().values(); }
  entries() { return this.capture().entries(); }
  forEach(callback: (value: V, key: string) => void) { this.capture().forEach(callback); }
  [Symbol.iterator]() { return this.entries(); }
}
