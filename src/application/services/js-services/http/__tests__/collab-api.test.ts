import { collab } from '@/proto/messages';
import { executeAPIRequest, executeAPIVoidRequest, getAxios, withRetry } from '@/application/services/js-services/http/core';
import { Types } from '@/application/types';

import {
  collabFullSyncBatch,
  createCollabVersion,
  deleteCollabVersion,
  getObjectPermission,
  revertCollabVersion,
} from '../collab-api';

jest.mock('@/application/services/js-services/device-id', () => ({
  getOrCreateDeviceId: jest.fn(() => 'test-device-id'),
}));

jest.mock('@/application/services/js-services/http/core', () => ({
  executeAPIRequest: jest.fn(),
  executeAPIVoidRequest: jest.fn(),
  getAxios: jest.fn(),
  parseRetryAfterSecs: jest.fn(),
  withRetry: jest.fn((fn: () => unknown) => fn()),
}));

const mockGetAxios = getAxios as unknown as jest.Mock;
const mockExecuteAPIRequest = executeAPIRequest as unknown as jest.Mock;
const mockExecuteAPIVoidRequest = executeAPIVoidRequest as unknown as jest.Mock;
const mockWithRetry = withRetry as unknown as jest.Mock;

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
        collabType: Types.Document,
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

describe('getObjectPermission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends collab_type for view permission queries', async () => {
    const get = jest.fn();

    mockGetAxios.mockReturnValue({ get });
    mockExecuteAPIRequest.mockImplementation(async (request: () => unknown) => {
      request();
      return {
        object_id: 'view-id',
        collab_type: Types.Document,
        governing_view_id: 'view-id',
        access_level: null,
        can_read: true,
        can_write: false,
        can_comment: false,
        can_share: false,
      };
    });

    const permission = await getObjectPermission('workspace-id', 'view-id', Types.Document);

    expect(permission.can_write).toBe(false);
    expect(get).toHaveBeenCalledWith('/api/workspace/workspace-id/collab/view-id/permission', {
      params: {
        collab_type: Types.Document,
      },
      signal: undefined,
    });
  });
});

describe('collab history APIs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithRetry.mockImplementation((fn: () => unknown) => fn());
  });

  it('retries permission-backpressured history mutations through the shared retry wrapper', async () => {
    const post = jest.fn();
    const deleteRequest = jest.fn();

    mockGetAxios.mockReturnValue({ post, delete: deleteRequest });
    mockExecuteAPIRequest
      .mockImplementationOnce(async (request: () => unknown) => {
        request();
        return 'version-id';
      })
      .mockImplementationOnce(async (request: () => unknown) => {
        request();
        return {
          state_vector: [1],
          doc_state: [2],
          collab_version: 'restored-version',
          version: 0,
        };
      });
    mockExecuteAPIVoidRequest.mockImplementationOnce(async (request: () => unknown) => {
      request();
    });

    await createCollabVersion('workspace-id', 'object-id', Types.Document, 'snapshot', new Uint8Array([1]));
    await deleteCollabVersion('workspace-id', 'object-id', 'version-id');
    await revertCollabVersion('workspace-id', 'object-id', Types.Document, 'version-id');

    expect(mockWithRetry).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenCalledWith('/api/workspace/workspace-id/collab/object-id/history', {
      snapshot: expect.any(String),
      name: 'snapshot',
      collab_type: Types.Document,
    });
    expect(deleteRequest).toHaveBeenCalledWith('/api/workspace/workspace-id/collab/object-id/history', {
      data: JSON.stringify('version-id'),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(post).toHaveBeenCalledWith('/api/workspace/workspace-id/collab/object-id/revert', {
      version: 'version-id',
      collab_type: Types.Document,
    });
  });
});
