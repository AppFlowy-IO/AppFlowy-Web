import { Blob as NodeBlob } from 'node:buffer';
import {
  CompressionStream as NodeCompressionStream,
  DecompressionStream as NodeDecompressionStream,
  ReadableStream as NodeReadableStream,
  WritableStream as NodeWritableStream,
} from 'node:stream/web';
import { gunzipSync, gzipSync } from 'node:zlib';

import { collab } from '@/proto/messages';
import { database_blob } from '@/proto/database_blob';
import { getAxios } from '@/application/services/js-services/http/core';

import {
  collabFullSyncBatch,
  databaseBlobDiff,
  getSlowSyncUploadTimeoutMs,
  SLOW_SYNC_PROBE_TIMEOUT_MS,
} from '../collab-api';

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

function installStalledGzipTransform(name: 'CompressionStream' | 'DecompressionStream') {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const cancelled = jest.fn();

  class StalledGzipTransform {
    readonly readable = new NodeReadableStream<Uint8Array>({
      start() {
        markStarted();
      },
      cancel(reason) {
        cancelled(reason);
      },
    });

    readonly writable = new NodeWritableStream<Uint8Array>();
  }

  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: StalledGzipTransform,
  });

  return { cancelled, started };
}

describe('collabFullSyncBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'CompressionStream', {
      configurable: true,
      value: NodeCompressionStream,
    });
    Object.defineProperty(globalThis, 'DecompressionStream', {
      configurable: true,
      value: NodeDecompressionStream,
    });
    Object.defineProperty(globalThis, 'Blob', {
      configurable: true,
      value: NodeBlob,
    });
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
    expect(config.timeout).toBeUndefined();
    expect(config.transformRequest[0](requestBody)).toBe(requestBody);
  });

  it('bounds a lightweight probe without marking it as a slow-lane upload', async () => {
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

    await collabFullSyncBatch(
      'workspace-id',
      [
        {
          objectId: 'object-id',
          collabType: 0,
          stateVector: new Uint8Array([1]),
          docState: new Uint8Array(),
        },
      ],
      { timeoutMs: SLOW_SYNC_PROBE_TIMEOUT_MS }
    );

    const config = post.mock.calls[0][2];

    expect(config.timeout).toBe(SLOW_SYNC_PROBE_TIMEOUT_MS);
    expect(config.headers['x-appflowy-sync-lane']).toBeUndefined();
  });

  it('forces gzip for one slow-lane object and decodes both compressed result payloads', async () => {
    const missingUpdate = new Uint8Array([3, 4, 5]);
    const serverStateVector = new Uint8Array([6, 7]);
    const responseBody = collab.CollabBatchSyncResponse.encode(
      collab.CollabBatchSyncResponse.create({
        results: [
          {
            objectId: 'object-id',
            collabType: 0,
            compression: collab.PayloadCompressionType.COMPRESSION_GZIP,
            missingUpdate: gzipSync(missingUpdate),
            serverStateVector: gzipSync(serverStateVector),
            collabVersion: 'version-1',
            messageId: { timestamp: 42, counter: 1 },
          },
        ],
        responseCompression: collab.PayloadCompressionType.COMPRESSION_NONE,
      })
    ).finish();
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: responseBody,
      headers: {},
    });

    mockGetAxios.mockReturnValue({ post });
    const controller = new AbortController();

    const results = await collabFullSyncBatch(
      'workspace-id',
      [
        {
          objectId: 'object-id',
          collabType: 0,
          stateVector: new Uint8Array([1]),
          docState: new Uint8Array([2]),
          collabVersion: 'version-1',
        },
      ],
      { syncLane: 'slow', signal: controller.signal }
    );
    const [, requestBody, config] = post.mock.calls[0];
    const request = collab.CollabBatchSyncRequest.decode(requestBody);
    const item = request.items[0];

    expect(config.headers['x-appflowy-sync-lane']).toBe('slow');
    expect(config.timeout).toBe(getSlowSyncUploadTimeoutMs(2));
    expect(config.signal).toBe(controller.signal);
    expect(request.items).toHaveLength(1);
    expect(item.compression).toBe(collab.PayloadCompressionType.COMPRESSION_GZIP);
    expect(item.collabVersion).toBe('version-1');
    expect(Array.from(gunzipSync(item.sv))).toEqual([1]);
    expect(Array.from(gunzipSync(item.docState))).toEqual([2]);
    expect(results[0]).toMatchObject({
      objectId: 'object-id',
      collabType: 0,
      collabVersion: 'version-1',
    });
    expect(Number(results[0].messageId?.timestamp)).toBe(42);
    expect(results[0].messageId?.counter).toBe(1);
    expect(Array.from(results[0].missingUpdate)).toEqual(Array.from(missingUpdate));
    expect(Array.from(results[0].serverStateVector)).toEqual(Array.from(serverStateVector));
  });

  it('leaves upload and server-processing headroom for large slow-sync payloads', () => {
    const sixteenMiBTimeout = getSlowSyncUploadTimeoutMs(16 * 1024 * 1024);
    const sixtyFourMiBTimeout = getSlowSyncUploadTimeoutMs(64 * 1024 * 1024);

    // 16 MiB takes about 90 seconds at 1.5 Mbps before the server's 60-second
    // processing budget. The deadline must cover both plus response headroom.
    expect(sixteenMiBTimeout).toBeGreaterThan(150_000);
    expect(sixtyFourMiBTimeout).toBeGreaterThan(sixteenMiBTimeout);
  });

  it('preserves explicit server errors instead of trying to decompress raw error vectors', async () => {
    const responseBody = collab.CollabBatchSyncResponse.encode(
      collab.CollabBatchSyncResponse.create({
        results: [
          {
            objectId: 'object-id',
            collabType: 0,
            compression: collab.PayloadCompressionType.COMPRESSION_GZIP,
            missingUpdate: new Uint8Array(),
            serverStateVector: new Uint8Array([0]),
            error: 'permission_denied',
          },
        ],
      })
    ).finish();
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: responseBody,
      headers: {},
    });

    mockGetAxios.mockReturnValue({ post });

    const results = await collabFullSyncBatch('workspace-id', [
      {
        objectId: 'object-id',
        collabType: 0,
        stateVector: new Uint8Array([1]),
        docState: new Uint8Array([2]),
      },
    ]);

    expect(results[0].error).toBe('permission_denied');
    expect(Array.from(results[0].serverStateVector)).toEqual([0]);
  });

  it('fails closed when the slow lane cannot gzip the request', async () => {
    const compressionStream = globalThis.CompressionStream;
    const decompressionStream = globalThis.DecompressionStream;

    Object.defineProperty(globalThis, 'CompressionStream', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, value: undefined });

    try {
      await expect(
        collabFullSyncBatch(
          'workspace-id',
          [
            {
              objectId: 'object-id',
              collabType: 0,
              stateVector: new Uint8Array([1]),
              docState: new Uint8Array([2]),
            },
          ],
          { syncLane: 'slow' }
        )
      ).rejects.toThrow('requires browser gzip compression support');
    } finally {
      Object.defineProperty(globalThis, 'CompressionStream', { configurable: true, value: compressionStream });
      Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, value: decompressionStream });
    }
  });

  it('rejects a multi-object slow-lane request before sending it', async () => {
    const item = {
      objectId: 'object-id',
      collabType: 0,
      stateVector: new Uint8Array([1]),
      docState: new Uint8Array([2]),
    };

    await expect(
      collabFullSyncBatch('workspace-id', [item, { ...item, objectId: 'other-id' }], { syncLane: 'slow' })
    ).rejects.toThrow('requires exactly one collab item');
    expect(mockGetAxios).not.toHaveBeenCalled();
  });

  it('cancels browser gzip compression before Axios starts', async () => {
    const { cancelled, started } = installStalledGzipTransform('CompressionStream');
    const controller = new AbortController();
    const request = collabFullSyncBatch(
      'workspace-id',
      [
        {
          objectId: 'object-id',
          collabType: 0,
          stateVector: new Uint8Array([1]),
          docState: new Uint8Array([2]),
        },
      ],
      { syncLane: 'slow', signal: controller.signal }
    );

    await started;
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalled();
    expect(mockGetAxios).not.toHaveBeenCalled();
  });

  it('cancels browser gzip decompression after Axios responds', async () => {
    const { cancelled, started } = installStalledGzipTransform('DecompressionStream');
    const responseBody = collab.CollabBatchSyncResponse.encode(
      collab.CollabBatchSyncResponse.create({
        results: [
          {
            objectId: 'object-id',
            collabType: 0,
            compression: collab.PayloadCompressionType.COMPRESSION_GZIP,
            missingUpdate: new Uint8Array([1]),
            serverStateVector: new Uint8Array([2]),
          },
        ],
      })
    ).finish();
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: responseBody,
      headers: {},
    });

    mockGetAxios.mockReturnValue({ post });
    const controller = new AbortController();
    const request = collabFullSyncBatch(
      'workspace-id',
      [
        {
          objectId: 'object-id',
          collabType: 0,
          stateVector: new Uint8Array([1]),
          docState: new Uint8Array(),
        },
      ],
      { signal: controller.signal }
    );

    await started;
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalled();
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
