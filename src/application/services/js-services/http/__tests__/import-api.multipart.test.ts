import axios from 'axios';

import { executeAPIVoidRequest, getAxios } from '../core';
import { ImportMultipartUploadInfo, uploadImportFileMultipart } from '../import-api';

jest.mock('@/application/services/js-services/http/core', () => ({
  executeAPIRequest: jest.fn(),
  executeAPIVoidRequest: jest.fn(),
  getAxios: jest.fn(),
}));

function multipart(partCount: number): ImportMultipartUploadInfo {
  return {
    s3_key: 'import.zip',
    upload_id: 'upload-1',
    part_presigned_urls: Array.from({ length: partCount }, (_, i) => ({
      part_number: i + 1,
      presigned_url: `https://upload.test/part-${i + 1}`,
    })),
  };
}

describe('multipart import request lifecycle', () => {
  const file = new File(['12345678901234'], 'export.zip', { type: 'application/zip' });
  let put: jest.SpyInstance;
  let post: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    put = jest.spyOn(axios, 'put');
    post = jest.fn().mockResolvedValue({ data: { code: 0 } });
    jest.mocked(getAxios).mockReturnValue({ post } as never);
    jest.mocked(executeAPIVoidRequest).mockImplementation(async (request) => {
      await request();
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['network', 'http'] as const)(
    'cancels sibling requests after a %s failure and never starts queued parts',
    async (failure) => {
      const caller = new AbortController();
      const pendingSignals: AbortSignal[] = [];

      put.mockImplementation((url: string, _data: Blob, config: { signal: AbortSignal }) => {
        if (url.endsWith('part-1')) {
          return failure === 'network'
            ? Promise.reject(new Error('Network unavailable'))
            : Promise.resolve({ status: 503, statusText: 'Unavailable', headers: {} });
        }

        pendingSignals.push(config.signal);
        return new Promise((_resolve, reject) => {
          config.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      });

      await expect(uploadImportFileMultipart(file, multipart(7), jest.fn(), caller.signal)).rejects.toMatchObject({
        message: failure === 'network' ? 'Network unavailable' : 'Multipart upload failed for part 1. Unavailable',
      });

      expect(put).toHaveBeenCalledTimes(5);
      expect(pendingSignals).toHaveLength(4);
      expect(pendingSignals.every((signal) => signal.aborted)).toBe(true);
      expect(caller.signal.aborted).toBe(false);
      expect(post).not.toHaveBeenCalled();
    }
  );

  it('forwards cancellation to multipart finalization and releases its abort listener', async () => {
    const caller = new AbortController();
    const removeListener = jest.spyOn(caller.signal, 'removeEventListener');
    let finalizationSignal: AbortSignal | undefined;
    let notifyFinalization: () => void = () => undefined;
    const finalizationStarted = new Promise<void>((resolve) => {
      notifyFinalization = resolve;
    });

    put.mockResolvedValue({ status: 200, headers: { etag: '"part-1"' } });
    post.mockImplementation((_url, _data, config) => {
      finalizationSignal = config?.signal;
      notifyFinalization();
      return new Promise((_resolve, reject) => {
        finalizationSignal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    });

    const upload = uploadImportFileMultipart(file, multipart(1), jest.fn(), caller.signal);

    await finalizationStarted;
    expect(finalizationSignal).toBeDefined();
    caller.abort();
    await expect(upload).rejects.toThrow('cancelled');
    expect(finalizationSignal?.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('completes successful parts in order and releases its abort listener', async () => {
    const caller = new AbortController();
    const removeListener = jest.spyOn(caller.signal, 'removeEventListener');

    put.mockImplementation(async (url: string) => ({ status: 200, headers: { etag: `"${url.split('/').pop()}"` } }));

    await uploadImportFileMultipart(file, multipart(3), jest.fn(), caller.signal);

    expect(post).toHaveBeenCalledWith(
      '/api/import/complete-multipart',
      {
        s3_key: 'import.zip',
        upload_id: 'upload-1',
        parts: [1, 2, 3].map((n) => ({ part_number: n, e_tag: `part-${n}` })),
      },
      { signal: expect.any(AbortSignal) }
    );
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
