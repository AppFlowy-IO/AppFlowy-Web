import { getAxios } from '../core';
import { duplicateRowDocument } from '../collab-api';

jest.mock('../core', () => ({
  executeAPIVoidRequest: (request: () => Promise<unknown>) => request(),
  getAxios: jest.fn(),
}));

jest.mock('@/application/services/js-services/device-id', () => ({
  getOrCreateDeviceId: jest.fn(() => 'test-device-id'),
}));

describe('duplicateRowDocument', () => {
  const post = jest.fn();
  const missingTarget = {
    code: 1008,
    message: 'Invalid request:new_row_id target-row does not belong to database database-id',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    post.mockReset();
    (getAxios as jest.Mock).mockReturnValue({ post });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('copies the document after the server registers the newly synced target row', async () => {
    post.mockRejectedValueOnce(missingTarget).mockResolvedValueOnce(undefined);

    const outcome = duplicateRowDocument('workspace-id', 'database-id', 'source-row', 'target-row', 'document-state')
      .catch((error: unknown) => error);

    await jest.runAllTimersAsync();

    await expect(outcome).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledTimes(2);
    for (const args of post.mock.calls) {
      expect(args).toEqual([
        '/api/workspace/workspace-id/database/database-id/row/source-row/duplicate-document',
        { new_row_id: 'target-row', client_doc_state_b64: 'document-state' },
      ]);
    }
  });

  it('stops retrying when the target row never registers', async () => {
    post.mockRejectedValue(missingTarget);
    const outcome = duplicateRowDocument('workspace-id', 'database-id', 'source-row', 'target-row')
      .catch((error: unknown) => error);

    await jest.runAllTimersAsync();

    await expect(outcome).resolves.toBe(missingTarget);
    expect(post).toHaveBeenCalledTimes(5);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    { code: 1012, message: 'Not enough permissions' },
    { code: -1, message: 'Network Error' },
    { code: 1017, message: 'Internal server error' },
    { code: 1008, message: 'Invalid request:destination row target-row already has a row document collab' },
    { code: 1008, message: 'Invalid request:source_row_id source-row does not belong to database database-id' },
    { code: 1008, message: 'Invalid request:new_row_id other-row does not belong to database database-id' },
  ])('does not retry a rejected or potentially accepted copy: $message', async (error) => {
    post.mockRejectedValue(error);

    await expect(
      duplicateRowDocument('workspace-id', 'database-id', 'source-row', 'target-row')
    ).rejects.toBe(error);
    expect(post).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
