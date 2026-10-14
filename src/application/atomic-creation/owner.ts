import { ClientValidationError } from '@/application/errors/client-validation-error';
import { captureTokenSession, isTokenSessionCurrent } from '@/application/session/token';
import { getCurrentOutboxSession, getCurrentOutboxSessionGeneration } from '@/application/sync-outbox';
import { getConfigValue } from '@/utils/runtime-config';
import { getServerInfoSnapshot } from '@/utils/server-info';

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

  if (!token.userId || session?.userId !== token.userId)
    throw new ClientValidationError('ATOMIC_CREATION_OWNER_CHANGED');
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
        throw new ClientValidationError('ATOMIC_CREATION_OWNER_CHANGED');
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
    throw new ClientValidationError('ATOMIC_CREATION_SERVER_UPGRADE');
  }
}

export function assertAtomicCreationAvailable(owner: AtomicCreationOwner): void {
  owner.assertCurrent();
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ClientValidationError('ATOMIC_CREATION_OFFLINE');
  assertAtomicCreationSupported();
}
