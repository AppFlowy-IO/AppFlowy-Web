import { listConnections } from '@/application/services/domains/integration';
import { EventType, on } from '@/application/session/event';
import { getTokenParsed } from '@/application/session/token';

import { onConnectionsChanged } from './connection-events';
import { DriveFile, getDriveFile } from './google-drive';
import { IntegrationConnection } from './types';

interface CachedRequest<T> {
  promise: Promise<T>;
  expiresAt: number;
}

interface FilePreviewCache {
  controller: AbortController;
  requests: Map<string, CachedRequest<DriveFile>>;
  listeners: Set<() => void>;
}

interface WorkspacePreviewCache {
  controller: AbortController;
  connections: Map<string, CachedRequest<IntegrationConnection[]>>;
  files: Map<string, FilePreviewCache>;
  dispose: () => void;
}

const workspaces = new Map<string, WorkspacePreviewCache>();
const CACHE_TTL_MS = 60_000;

export interface DrivePreviewSnapshot {
  thumbnail?: string;
  metadata?: DriveFile;
  status: 'loading' | 'ready' | 'reconnect' | 'error';
  version: number;
}

function cachedRequest<T>(cache: Map<string, CachedRequest<T>>, key: string, load: () => Promise<T>) {
  const cached = cache.get(key);

  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const entry: CachedRequest<T> = {
    expiresAt: Infinity,
    promise: load().then(
      (value) => {
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return value;
      },
      (error: unknown) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      }
    ),
  };

  cache.set(key, entry);
  return entry.promise;
}

function invalidateFile(file: FilePreviewCache) {
  file.controller.abort();
  file.controller = new AbortController();
  file.requests.clear();
  file.listeners.forEach((listener) => listener());
}

function workspaceCache(workspaceId: string, userId: string) {
  const key = JSON.stringify([userId, workspaceId]);
  const existing = workspaces.get(key);

  if (existing) return existing;
  const cache: WorkspacePreviewCache = {
    controller: new AbortController(),
    connections: new Map(),
    files: new Map(),
    dispose: () => {
      cache.controller.abort();
      cache.files.forEach((file) => file.controller.abort());
      unsubscribeConnections();
      unsubscribeSession();
      unsubscribeRefresh();
      window.removeEventListener('storage', onStorage);
      workspaces.delete(key);
    },
  };
  const invalidate = () => {
    cache.controller.abort();
    cache.controller = new AbortController();
    cache.connections.clear();
    cache.files.forEach(invalidateFile);
  };

  const onSessionChange = () => {
    if (getTokenParsed()?.user.id !== userId) invalidate();
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === 'token' || event.key === null) onSessionChange();
  };

  const unsubscribeConnections = onConnectionsChanged(workspaceId, invalidate);
  const unsubscribeSession = on(EventType.SESSION_INVALID, invalidate);
  const unsubscribeRefresh = on(EventType.SESSION_REFRESH, onSessionChange);

  window.addEventListener('storage', onStorage);
  workspaces.set(key, cache);
  return cache;
}

/** Share session-only requests while previews are mounted; the last reader releases them. */
export function subscribeDrivePreview(
  workspaceId: string,
  fileId: string,
  userId: string,
  email: string | undefined,
  onChange: (snapshot: DrivePreviewSnapshot) => void
) {
  const workspace = workspaceCache(workspaceId, userId);
  let file = workspace.files.get(fileId);

  if (!file) {
    file = { controller: new AbortController(), requests: new Map(), listeners: new Set() };
    workspace.files.set(fileId, file);
  }

  const fileCache = file;
  let active = true;
  let version = 0;
  const load = () => {
    const currentVersion = version;
    const signal = fileCache.controller.signal;
    const isCurrent = () =>
      active && version === currentVersion && !signal.aborted && getTokenParsed()?.user.id === userId;

    onChange({ version: currentVersion, status: 'loading' });
    if (!isCurrent()) return;
    void (async () => {
      const connections = (
        await cachedRequest(workspace.connections, workspaceId, () =>
          listConnections(workspaceId, workspace.controller.signal)
        )
      )
        .filter((connection) => connection.provider === 'google-drive')
        .sort(
          (first, second) => Number(second.account_identifier === email) - Number(first.account_identifier === email)
        );

      let failed = false;

      for (const connection of connections) {
        if (!isCurrent()) return;
        const metadata = await cachedRequest(fileCache.requests, connection.id, () =>
          getDriveFile(workspaceId, connection.id, fileId, signal)
        ).catch((error: unknown) => {
          const failure = error as { httpStatus?: number; code?: number; response?: { status?: number } } | null;
          const status = failure?.httpStatus || failure?.response?.status || failure?.code;

          // Match Flutter's access recovery for 403/404. Transport/provider
          // failures should offer retry rather than starting another OAuth flow.
          if (status !== 401 && status !== 403 && status !== 404 && status !== 1003) failed = true;
          return undefined;
        });
        const url = metadata?.thumbnailLink;

        if (metadata?.trashed) failed = true;

        if (metadata && !metadata.trashed && isCurrent()) {
          let thumbnail: string | undefined;

          try {
            const parsed = new URL(url || '');

            if (
              parsed.protocol === 'https:' &&
              (parsed.hostname.endsWith('.googleusercontent.com') || parsed.hostname === 'drive.google.com')
            )
              thumbnail = url;
          } catch {
            /* Missing or malformed thumbnails still allow the Google preview. */
          }

          onChange({ thumbnail, metadata, status: 'ready', version: currentVersion });
          return;
        }
      }

      if (isCurrent()) onChange({ status: failed ? 'error' : 'reconnect', version: currentVersion });
    })().catch(() => {
      if (isCurrent()) onChange({ status: 'error', version: currentVersion });
    });
  };

  const refresh = () => {
    version++;
    load();
  };

  fileCache.listeners.add(refresh);
  load();
  return {
    reload: () => {
      workspace.connections.clear();
      invalidateFile(fileCache);
    },
    unsubscribe: () => {
      active = false;
      fileCache.listeners.delete(refresh);
      if (fileCache.listeners.size) return;
      fileCache.controller.abort();
      workspace.files.delete(fileId);
      if (!workspace.files.size) workspace.dispose();
    },
  };
}
