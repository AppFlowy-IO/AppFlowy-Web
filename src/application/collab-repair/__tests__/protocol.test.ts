import { collab, messages } from '@/proto/messages';

import { NIL_RESTORE_ID, parseRepairRequest, REPAIR_MAX_UPDATE_BYTES } from '../types';

const objectId = '11111111-1111-1111-1111-111111111111';
const requestId = '22222222-2222-2222-2222-222222222222';
const databaseId = '33333333-3333-3333-3333-333333333333';
const notice = (type = 0): collab.ICollabMessage => ({
  objectId,
  collabType: type,
  repairRequest: {
    requestId,
    stateVector: new Uint8Array([0]),
    maxUpdateBytes: 16 * 1024 * 1024,
    ...(type === 0 ? {} : { databaseId: type === 1 ? objectId : databaseId, databaseRestoreId: NIL_RESTORE_ID }),
  },
});

test.each([0, 1, 4])('protobuf repair request preserves optional branch metadata for type %i', (type) => {
  const frame = messages.Message.encode({ collabMessage: notice(type) }).finish();
  const decoded = messages.Message.decode(frame).collabMessage!;
  const request = parseRepairRequest(decoded);

  expect(request).toEqual({
    requestId,
    objectId,
    collabType: type,
    stateVector: new Uint8Array([0]),
    version: undefined,
    databaseId: type === 0 ? undefined : type === 1 ? objectId : databaseId,
    databaseRestoreId: type === 0 ? undefined : NIL_RESTORE_ID,
    maxUpdateBytes: REPAIR_MAX_UPDATE_BYTES,
  });
  expect(decoded.syncRequest).toBeNull();
  expect(decoded.update).toBeNull();
});

test('the additive tag leaves ordinary sync-request wire bytes unchanged', () => {
  const message = collab.CollabMessage.decode(new Uint8Array([10, 1, 97, 26, 3, 18, 1, 0]));

  expect(message.objectId).toBe('a');
  expect(message.syncRequest?.stateVector).toEqual(new Uint8Array([0]));
  expect(message.repairRequest).toBeNull();
  expect(new Uint8Array(collab.CollabMessage.encode(message).finish())).toEqual(
    new Uint8Array([10, 1, 97, 26, 3, 18, 1, 0])
  );
});

test('rejects unsupported objects, unbounded requests and ambiguous database provenance', () => {
  const cases: collab.ICollabMessage[] = [
    notice(2),
    { ...notice(), objectId: NIL_RESTORE_ID },
    { ...notice(), repairRequest: { ...notice().repairRequest, requestId: NIL_RESTORE_ID } },
    { ...notice(4), repairRequest: { ...notice(4).repairRequest, databaseId: NIL_RESTORE_ID } },
    { ...notice(), objectId: 'invalid' },
    { ...notice(), repairRequest: { ...notice().repairRequest, stateVector: new Uint8Array() } },
    { ...notice(), repairRequest: { ...notice().repairRequest, maxUpdateBytes: 0 } },
    { ...notice(), repairRequest: { ...notice().repairRequest, databaseId } },
    { ...notice(1), repairRequest: { ...notice(1).repairRequest, databaseId } },
    { ...notice(4), repairRequest: { ...notice(4).repairRequest, databaseRestoreId: undefined } },
    { ...notice(4), repairRequest: { ...notice(4).repairRequest, databaseId: undefined } },
    { ...notice(), repairRequest: { ...notice().repairRequest, version: 'invalid' } },
  ];

  for (const message of cases) expect(parseRepairRequest(message)).toBeUndefined();
});
