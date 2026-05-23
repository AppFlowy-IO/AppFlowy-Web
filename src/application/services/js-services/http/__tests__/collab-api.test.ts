import { collab } from '@/proto/messages';
import { getAxios } from '@/application/services/js-services/http/core';

import { collabFullSyncBatch } from '../collab-api';

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
