import type { collab } from '@/proto/messages';

export const REPAIR_MAX_UPDATE_BYTES = 4 * 1024 * 1024;
export const REPAIR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const REPAIR_MAX_SOURCE_UPDATES = 4096;
export const REPAIR_TIMEOUT_MS = 3000;
export const NIL_RESTORE_ID = '00000000-0000-0000-0000-000000000000';

/** A server-selected object and branch, never permission to reset a local document. */
export interface RepairRequest {
  requestId: string;
  objectId: string;
  collabType: 0 | 1 | 4;
  stateVector: Uint8Array;
  version: string | undefined;
  databaseRestoreId: string | undefined;
  databaseId: string | undefined;
  maxUpdateBytes: number;
}

/** Source metadata is captured with the bytes, rather than copied from the repair notice. */
export interface RepairUpdate {
  objectId: string;
  collabType: number;
  payload: Uint8Array;
  version: string | undefined;
  databaseRestoreId: string | undefined;
  beforeStateVector: Uint8Array;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRepairRequest(message: collab.ICollabMessage): RepairRequest | undefined {
  const request = message.repairRequest;
  const type = message.collabType;

  if (
    !request ||
    !message.objectId ||
    !uuid.test(message.objectId) ||
    message.objectId === NIL_RESTORE_ID ||
    !request.requestId ||
    !uuid.test(request.requestId) ||
    request.requestId === NIL_RESTORE_ID ||
    (type !== 0 && type !== 1 && type !== 4) ||
    !request.stateVector?.length ||
    request.stateVector.length > 64 * 1024 ||
    !Number.isSafeInteger(request.maxUpdateBytes) ||
    (request.maxUpdateBytes ?? 0) <= 0
  )
    return;
  const version = request.version ?? undefined;
  const databaseRestoreId = request.databaseRestoreId ?? undefined;
  const databaseId = request.databaseId ?? undefined;

  if (
    (version !== undefined && !uuid.test(version)) ||
    (databaseRestoreId !== undefined && !uuid.test(databaseRestoreId)) ||
    (databaseId !== undefined && (!uuid.test(databaseId) || databaseId === NIL_RESTORE_ID))
  )
    return;
  if (type === 0 && (databaseId !== undefined || databaseRestoreId !== undefined)) return;
  if (type !== 0 && (!databaseId || !databaseRestoreId || (type === 1 && databaseId !== message.objectId))) return;

  return {
    requestId: request.requestId,
    objectId: message.objectId,
    collabType: type,
    stateVector: new Uint8Array(request.stateVector),
    version,
    databaseRestoreId,
    databaseId,
    maxUpdateBytes: Math.min(request.maxUpdateBytes!, REPAIR_MAX_UPDATE_BYTES),
  };
}
