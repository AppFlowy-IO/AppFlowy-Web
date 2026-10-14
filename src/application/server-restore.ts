import { getConfigValue } from '@/utils/runtime-config';

export const INITIAL_SERVER_RESTORE_ID = '00000000-0000-0000-0000-000000000000';
const CACHE_PREFIX = 'server-restore:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isRestoreId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * A tab's storage and network generation never change in place. Reloading is
 * essential: merging an older Yjs snapshot cannot undo newer local operations.
 * Old tabs may finish persistence work, but can only write their old namespace.
 */
export class ServerRestoreBoundary {
  readonly restoreId: string;
  readonly storageKey: string;
  private retiring = false;

  constructor(
    serverUrl: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>,
    private readonly reload: () => void
  ) {
    this.storageKey = `af_server_restore:v1:${serverUrl.replace(/\/+$/, '')}`;
    const stored = this.readStoredId();

    this.restoreId = stored ?? INITIAL_SERVER_RESTORE_ID;
  }

  private readStoredId(): string | undefined {
    try {
      const value = this.storage.getItem(this.storageKey);

      return isRestoreId(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /** Keep legacy caches on normal restarts; a committed restore gets fresh storage. */
  cacheKey(name: string): string {
    return this.restoreId === INITIAL_SERVER_RESTORE_ID ? name : `${CACHE_PREFIX}${this.restoreId}:${name}`;
  }

  /** Database enumeration must not discover caches left by a different generation. */
  logicalCacheKey(name: string): string | undefined {
    if (this.restoreId === INITIAL_SERVER_RESTORE_ID) return name.startsWith(CACHE_PREFIX) ? undefined : name;
    const prefix = this.cacheKey('');

    return name.startsWith(prefix) ? name.slice(prefix.length) : undefined;
  }

  assertCurrent(): void {
    const stored = this.readStoredId();

    if (!this.retiring && stored && stored !== this.restoreId) this.retire();
    if (this.retiring) throw new Error('Server restore changed; this page is reloading');
  }

  /** Called with fresh discovery or the server's explicit stale-generation rejection. */
  accept(restoreId: unknown): void {
    this.assertCurrent();
    // Old servers omit the field and keep their existing synchronization contract.
    if (restoreId === undefined) return;
    if (!isRestoreId(restoreId)) throw new Error('Invalid server restore identifier');
    if (restoreId === this.restoreId) return;

    // Do not reconnect if storage is denied: a reload could otherwise select the
    // old cache again. The server also fences HTTP requests that raced discovery.
    this.storage.setItem(this.storageKey, restoreId);
    this.retire();
    this.assertCurrent();
  }

  private retire(): void {
    this.retiring = true;
    this.reload();
  }
}

export const serverRestore = new ServerRestoreBoundary(
  getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'),
  {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  },
  () => window.location.reload()
);

// Background/follower tabs must retire even when they do not own a socket.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== serverRestore.storageKey || !isRestoreId(event.newValue)) return;
    try {
      serverRestore.assertCurrent();
    } catch {
      // assertCurrent already scheduled the reload; no stale work is resumed.
    }
  });
}
