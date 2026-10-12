import { captureTokenSession, isTokenSessionCurrent } from '@/application/session/token';
import { getCurrentOutboxSession, getCurrentOutboxSessionGeneration } from '@/application/sync-outbox';
import { getConfigValue } from '@/utils/runtime-config';
import { getServerInfoSnapshot } from '@/utils/server-info';

import { atomicCreationMessage } from './errors';

export interface AtomicCreationOwner {
  readonly serverUrl: string;
  readonly userId: string;
  readonly workspaceId: string;
  assertCurrent(): void;
}

function serverUrl(): string {
  return getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
}

/** Token rotation preserves this witness; logout, workspace cutover and remount do not. */
export function captureAtomicCreationOwner(workspaceId: string, checkCurrent?: () => void): AtomicCreationOwner {
  const token = captureTokenSession();
  const session = getCurrentOutboxSession(workspaceId);
  const generation = getCurrentOutboxSessionGeneration();
  const origin = serverUrl();

  if (!token.userId || session?.userId !== token.userId) throw new Error(atomicCreationMessage('ownerChanged'));
  const owner: AtomicCreationOwner = {
    serverUrl: origin,
    userId: token.userId,
    workspaceId,
    assertCurrent() {
      const current = getCurrentOutboxSession(workspaceId);

      if (
        !isTokenSessionCurrent(token) ||
        serverUrl() !== origin ||
        getCurrentOutboxSessionGeneration() !== generation ||
        current?.userId !== token.userId
      ) {
        throw new Error(atomicCreationMessage('ownerChanged'));
      }

      checkCurrent?.();
    },
  };

  owner.assertCurrent();
  return Object.freeze(owner);
}

export function assertAtomicCreationSupported(): void {
  const state = getServerInfoSnapshot();

  if (
    state.status !== 'available' ||
    state.info.enable_atomic_creation !== true ||
    state.info.enable_atomic_creation_defaults !== true
  ) {
    throw new Error(atomicCreationMessage('serverUpgrade'));
  }
}

export function assertAtomicCreationAvailable(owner: AtomicCreationOwner): void {
  owner.assertCurrent();
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error(atomicCreationMessage('offline'));
  assertAtomicCreationSupported();
}
