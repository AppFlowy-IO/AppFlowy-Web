import { TextDecoder, TextEncoder } from 'util';
import { parse as uuidBytes } from 'uuid';
import * as Y from 'yjs';

import { getDatabaseHistoryRows, previewDatabaseVersion } from '@/application/services/domains/database-history';
import { database_blob } from '@/proto/database_blob';

import { loadDatabaseHistoryPreview } from '../databaseHistoryPreviewSession';

jest.mock('@/application/services/domains/database-history', () => ({
  getDatabaseHistoryRows: jest.fn(), previewDatabaseVersion: jest.fn(),
}));

const rowId = 'de90c32e-ae93-4c45-8a2c-18bf1bfb07e1';
const controller = () => new AbortController();
const params = { workspaceId: 'w', databaseId: 'd', version: 'v', rowCount: 1 };

beforeAll(() => {
  Object.assign(global, { TextDecoder, TextEncoder });
});
beforeEach(() => {
  jest.clearAllMocks();
  const root = new Y.Doc();

  root.getMap('database').set('name', 'Historical');
  jest.mocked(previewDatabaseVersion).mockResolvedValue(Y.encodeStateAsUpdate(root));
  root.destroy();
});

function historicalRow(encoderVersion = 1) {
  const doc = new Y.Doc();

  doc.getMap('row').set('title', 'Old title');
  const docState = encoderVersion === 2 ? Y.encodeStateAsUpdateV2(doc) : Y.encodeStateAsUpdate(doc);

  doc.destroy();
  return { rowId: uuidBytes(rowId), docState: { docState, encoderVersion } };
}

test.each([1, 2])('loads Yjs encoding %i in an isolated session and destroys it', async (encoder) => {
  jest.mocked(getDatabaseHistoryRows).mockResolvedValue(new database_blob.DatabaseBlobDiffResponse({
    manifestVersion: 'v', updates: [historicalRow(encoder)], page: { hasMore: false },
  }));
  const session = await loadDatabaseHistoryPreview({ ...params, signal: controller().signal });

  expect(session.root.getMap('database').get('name')).toBe('Historical');
  expect(session.rows[rowId].getMap('row').get('title')).toBe('Old title');
  expect(session.root.guid).not.toBe('d');
  expect(session.rows[rowId].guid).not.toBe(rowId);
  const rootDestroyed = jest.fn();
  const rowDestroyed = jest.fn();

  session.root.on('destroy', rootDestroyed);
  session.rows[rowId].on('destroy', rowDestroyed);
  session.destroy();
  expect(rootDestroyed).toHaveBeenCalledTimes(1);
  expect(rowDestroyed).toHaveBeenCalledTimes(1);
});

test('walks opaque UTF-8 cursors and rejects incomplete snapshots', async () => {
  jest.mocked(getDatabaseHistoryRows)
    .mockResolvedValueOnce(new database_blob.DatabaseBlobDiffResponse({
      manifestVersion: 'v', updates: [], page: { hasMore: true, nextCursor: new TextEncoder().encode('opaque+/=') },
    }))
    .mockResolvedValueOnce(new database_blob.DatabaseBlobDiffResponse({ manifestVersion: 'v', updates: [] }));
  const signal = controller().signal;

  await expect(loadDatabaseHistoryPreview({ ...params, signal })).rejects.toThrow('incomplete');
  expect(getDatabaseHistoryRows).toHaveBeenNthCalledWith(2, 'w', 'd', 'v', { cursor: 'opaque+/=', signal });
});

test('cancels before hydration and never requests rows for an obsolete root', async () => {
  const abort = controller();

  abort.abort();
  await expect(loadDatabaseHistoryPreview({ ...params, signal: abort.signal })).rejects.toThrow('cancelled');
  expect(getDatabaseHistoryRows).not.toHaveBeenCalled();
});

test('rejects repeated page cursors instead of looping', async () => {
  jest.mocked(getDatabaseHistoryRows).mockResolvedValue(new database_blob.DatabaseBlobDiffResponse({
    manifestVersion: 'v', updates: [], page: { hasMore: true, nextCursor: new TextEncoder().encode('same') },
  }));
  await expect(loadDatabaseHistoryPreview({ ...params, signal: controller().signal })).rejects.toThrow('did not advance');
  expect(getDatabaseHistoryRows).toHaveBeenCalledTimes(2);
});
