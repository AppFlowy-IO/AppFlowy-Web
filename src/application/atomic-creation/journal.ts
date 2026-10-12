import { db } from '@/application/db';
import { postAtomicCreation } from '@/application/services/js-services/http/atomic-creation-api';
import { captureTokenSession, isTokenSessionCurrent } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

import { atomicCreationMessage } from './errors';
import { assertAtomicCreationAvailable, type AtomicCreationOwner } from './owner';
import { validateAtomicCreationReceipt } from './receipt';

import type { AtomicCreationKind, AtomicCreationReceipt, AtomicCreationRecord, AtomicCreationRequests } from './types';

const inFlight = new Set<string>();
const activityListeners = new Set<() => void>();
let activityRevision = 0;

export function isAtomicCreationInFlight(recordId: string): boolean {
  return inFlight.has(recordId);
}

export function getAtomicCreationActivityRevision(): number {
  return activityRevision;
}

export function subscribeAtomicCreationActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

function publishActivity(): void {
  activityRevision += 1;
  activityListeners.forEach((listener) => listener());
}

export class AtomicCreationPendingError extends Error {
  readonly requestId: string;
  readonly recordId: string;
  readonly cause: unknown;

  constructor(record: AtomicCreationRecord, cause: unknown) {
    super(atomicCreationMessage('pending'));
    this.name = 'AtomicCreationPendingError';
    this.requestId = record.requestId;
    this.recordId = record.id;
    this.cause = cause;
  }
}

function recordId(owner: AtomicCreationOwner, kind: AtomicCreationKind, logicalTarget: string): string {
  return JSON.stringify([owner.serverUrl, owner.userId, owner.workspaceId, kind, logicalTarget]);
}

function checkRecord(owner: AtomicCreationOwner, record: AtomicCreationRecord): void {
  owner.assertCurrent();
  if (
    record.serverUrl !== owner.serverUrl ||
    record.userId !== owner.userId ||
    record.workspaceId !== owner.workspaceId ||
    record.id !== recordId(owner, record.kind, record.logicalTarget)
  )
    throw new Error('Atomic creation belongs to another owner');
}

export function parseAtomicCreationRequest<K extends AtomicCreationKind>(
  record: AtomicCreationRecord<K>
): AtomicCreationRequests[K] {
  const request = JSON.parse(record.requestJson) as AtomicCreationRequests[K];

  if (!request || request.request_id !== record.requestId)
    throw new Error('Atomic creation journal identity is invalid');
  return request;
}

/** Includes an acknowledged command whose current-state hydration has not completed. */
export async function findPendingAtomicCreation<K extends AtomicCreationKind>(
  owner: AtomicCreationOwner,
  kind: K,
  logicalTarget: string
): Promise<AtomicCreationRecord<K> | undefined> {
  owner.assertCurrent();
  const record = (await db.atomic_creation.get(recordId(owner, kind, logicalTarget))) as
    | AtomicCreationRecord<K>
    | undefined;

  owner.assertCurrent();
  if (record) {
    checkRecord(owner, record);
    parseAtomicCreationRequest(record);
  }

  return record;
}

/** Explicit recovery UI may discover these; reconnect never submits them automatically. */
export async function listPendingAtomicCreations(owner: AtomicCreationOwner): Promise<AtomicCreationRecord[]> {
  owner.assertCurrent();
  const records = await db.atomic_creation
    .where('[serverUrl+userId+workspaceId]')
    .equals([owner.serverUrl, owner.userId, owner.workspaceId])
    .toArray();

  owner.assertCurrent();
  records.forEach((record) => {
    checkRecord(owner, record);
    parseAtomicCreationRequest(record);
  });
  return records;
}

/** Discovery can render before the workspace sync owner mounts; it never submits or hydrates. */
export async function listPendingAtomicCreationsForCurrentUser(workspaceId: string): Promise<AtomicCreationRecord[]> {
  const session = captureTokenSession();
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');

  if (!session.userId) return [];
  const records = await db.atomic_creation
    .where('[serverUrl+userId+workspaceId]')
    .equals([serverUrl, session.userId, workspaceId])
    .toArray();

  if (
    !isTokenSessionCurrent(session) ||
    serverUrl !== getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud')
  ) {
    throw new Error(atomicCreationMessage('ownerChanged'));
  }

  records.forEach(parseAtomicCreationRequest);
  return records;
}

interface RecoveryOptions<K extends AtomicCreationKind, T> {
  owner: AtomicCreationOwner;
  record: AtomicCreationRecord<K>;
  /** Optional workflow deadline/cancellation, shared by preparation, POST and hydration. */
  signal?: AbortSignal;
  /** Runs after loading the durable record, before submission or hydration. */
  onPrepared?: (record: AtomicCreationRecord<K>) => Promise<void>;
  /** Gates live source causality; it never changes the stored command. */
  beforeSubmit?: (owner: AtomicCreationOwner) => Promise<void>;
  /** Must read current authorized content and guard publication with owner.assertCurrent(). */
  hydrate: (receipt: AtomicCreationReceipt<K>, owner: AtomicCreationOwner) => Promise<T>;
}

export async function recoverAtomicCreation<K extends AtomicCreationKind, T>(
  options: RecoveryOptions<K, T>
): Promise<T> {
  const id = options.record.id;

  if (inFlight.has(id))
    throw new AtomicCreationPendingError(options.record, new Error('Creation is already in progress'));
  inFlight.add(id);
  try {
    publishActivity();
    return await recover(options);
  } finally {
    inFlight.delete(id);
    publishActivity();
  }
}

async function recover<K extends AtomicCreationKind, T>(options: RecoveryOptions<K, T>): Promise<T> {
  const { owner, hydrate, beforeSubmit, signal } = options;
  let record = options.record;

  checkRecord(owner, record);
  // Read the actual durable stage, rather than trusting an old handle supplied by a component.
  const persisted = (await db.atomic_creation.get(record.id)) as AtomicCreationRecord<K> | undefined;

  checkRecord(owner, record);
  if (!persisted || persisted.requestJson !== record.requestJson) throw new Error('Atomic creation journal changed');
  record = persisted;
  const request = parseAtomicCreationRequest(record);

  try {
    assertNotCancelled(signal);
    await options.onPrepared?.(record);
    owner.assertCurrent();
    assertNotCancelled(signal);
    let receipt: AtomicCreationReceipt<K>;

    if (record.state === 'committed') {
      receipt = JSON.parse(record.receiptJson ?? 'null') as AtomicCreationReceipt<K>;
      validateAtomicCreationReceipt(record.kind, request, record.logicalTarget, receipt);
    } else {
      assertAtomicCreationAvailable(owner);
      await beforeSubmit?.(owner);
      assertAtomicCreationAvailable(owner);
      receipt = await postAtomicCreation(owner, record.kind, record.requestJson, signal);
      validateAtomicCreationReceipt(record.kind, request, record.logicalTarget, receipt);
      const receiptJson = JSON.stringify(receipt);

      // Even a late ACK belongs durably to its original account. A session change
      // prevents hydration below, but must not discard the committed receipt.
      await db.transaction('rw', db.atomic_creation, async () => {
        const current = await db.atomic_creation.get(record.id);

        if (!current || current.requestJson !== record.requestJson) throw new Error('Atomic creation journal changed');
        if (current.state === 'committed') {
          // A concurrent same-request submission cannot replace the original ACK.
          const original: unknown = JSON.parse(current.receiptJson ?? 'null');

          validateAtomicCreationReceipt(record.kind, request, record.logicalTarget, original);
          receipt = original;
        } else {
          await db.atomic_creation.put({ ...current, state: 'committed', receiptJson });
        }
      });
    }

    owner.assertCurrent();
    assertNotCancelled(signal);
    const result = await hydrate(receipt, owner);

    owner.assertCurrent();
    assertNotCancelled(signal);
    await db.transaction('rw', db.atomic_creation, async () => {
      owner.assertCurrent();
      const current = await db.atomic_creation.get(record.id);

      owner.assertCurrent();
      if (current?.requestJson === record.requestJson) await db.atomic_creation.delete(record.id);
    });
    owner.assertCurrent();
    return result;
  } catch (error) {
    throw new AtomicCreationPendingError(record, error);
  }
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Atomic creation cancelled');
}

export async function runAtomicCreation<K extends AtomicCreationKind, T>(options: {
  owner: AtomicCreationOwner;
  kind: K;
  request: AtomicCreationRequests[K];
  logicalTarget: string;
  signal?: AbortSignal;
  onPrepared?: RecoveryOptions<K, T>['onPrepared'];
  beforeSubmit?: RecoveryOptions<K, T>['beforeSubmit'];
  hydrate: RecoveryOptions<K, T>['hydrate'];
}): Promise<T> {
  const { owner, kind, request, logicalTarget } = options;

  assertNotCancelled(options.signal);
  assertAtomicCreationAvailable(owner);
  const requestJson = JSON.stringify(request);
  const record: AtomicCreationRecord<K> = {
    id: recordId(owner, kind, logicalTarget),
    serverUrl: owner.serverUrl,
    userId: owner.userId,
    workspaceId: owner.workspaceId,
    kind,
    logicalTarget,
    requestId: request.request_id,
    requestJson,
    state: 'pending',
    createdAt: Date.now(),
  };

  parseAtomicCreationRequest(record);
  await db.transaction('rw', db.atomic_creation, async () => {
    owner.assertCurrent();
    const existing = await db.atomic_creation.get(record.id);

    owner.assertCurrent();
    if (existing && existing.requestJson !== requestJson)
      throw new AtomicCreationPendingError(
        existing,
        new Error('Recover the original creation before preparing another request')
      );
    if (!existing) await db.atomic_creation.add(record);
  });
  return recoverAtomicCreation({ ...options, record });
}
