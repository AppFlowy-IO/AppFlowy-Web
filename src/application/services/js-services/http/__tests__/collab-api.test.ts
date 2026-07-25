import { collab } from '@/proto/messages';
import { database_blob } from '@/proto/database_blob';
import { getAxios } from '@/application/services/js-services/http/core';

import { collabFullSyncBatch, databaseBlobDiff } from '../collab-api';

jest.mock('@/application/services/js-services/device-id', () => ({
  getOrCreateDeviceId: jest.fn(() => 'test-device-id'),
}));

jest.mock('@/application/services/js-services/http/core', () => ({
  executeAPIRequest: jest.fn(),
  executeAPIVoidRequest: jest.fn(),
  getAxios: jest.fn(),
  parseRetryAfterSecs: jest.fn(),
}));

const mockGetAxios = getAxios as unknown as jest.Mock;

describe('collabFullSyncBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends the encoded protobuf view instead of the pooled backing buffer', async () => {
    const responseBody = collab.CollabBatchSyncResponse.encode(
      collab.CollabBatchSyncResponse.create({
        results: [],
        responseCompression: collab.PayloadCompressionType.COMPRESSION_NONE,
      })
    ).finish();
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: responseBody,
      headers: {},
    });

    mockGetAxios.mockReturnValue({ post });

    await collabFullSyncBatch('workspace-id', [
      {
        objectId: 'object-id',
        collabType: 0,
        stateVector: new Uint8Array([1]),
        docState: new Uint8Array([2]),
      },
    ]);

    const [, requestBody, config] = post.mock.calls[0];

    expect(ArrayBuffer.isView(requestBody)).toBe(true);
    expect(requestBody.byteLength).toBeLessThan(requestBody.buffer.byteLength);
    expect(config.transformRequest[0](requestBody)).toBe(requestBody);
  });
});

describe('databaseBlobDiff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('round-trips a paged protobuf request and response', async () => {
    const responseBody = database_blob.DatabaseBlobDiffResponse.encode(
      database_blob.DatabaseBlobDiffResponse.create({
        status: database_blob.DiffStatus.READY,
        page: {
          hasMore: true,
          nextCursor: new Uint8Array([7, 8, 9]),
          restartRequired: false,
        },
      })
    ).finish();
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: responseBody,
      headers: {},
    });

    mockGetAxios.mockReturnValue({ post });

    const response = await databaseBlobDiff(
      'workspace-id',
      'database-id',
      database_blob.DatabaseBlobDiffRequest.create({
        maxKnownRid: { timestamp: 100, seqNo: 2 },
        version: 3,
        page: {
          maxItems: 256,
          maxBytes: 16 * 1024 * 1024,
          cursor: new Uint8Array([1, 2, 3]),
        },
      })
    );

    const [url, requestBody, config] = post.mock.calls[0];
    const decodedRequest = database_blob.DatabaseBlobDiffRequest.decode(requestBody);

    expect(url).toBe('/api/workspace/workspace-id/database/database-id/blob/diff');
    expect(decodedRequest.version).toBe(3);
    expect(Number(decodedRequest.maxKnownRid?.timestamp)).toBe(100);
    expect(decodedRequest.maxKnownRid?.seqNo).toBe(2);
    expect(decodedRequest.page?.maxItems).toBe(256);
    expect(Number(decodedRequest.page?.maxBytes)).toBe(16 * 1024 * 1024);
    expect(Array.from(decodedRequest.page?.cursor ?? [])).toEqual([1, 2, 3]);
    expect(config.headers['Content-Type']).toBe('application/octet-stream');
    expect(response.page).toMatchObject({
      hasMore: true,
      restartRequired: false,
    });
    expect(Array.from(response.page?.nextCursor ?? [])).toEqual([7, 8, 9]);
  });
});
