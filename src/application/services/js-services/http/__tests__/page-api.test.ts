import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { CrossWorkspaceCopyTaskState } from '@/application/types';

import {
  copyPageToWorkspace,
  CrossWorkspaceCopyTerminalError,
  getCrossWorkspaceCopyTask,
  waitForCrossWorkspaceCopyTask,
} from '../page-api';

jest.mock('@/application/services/js-services/http/core', () => ({
  executeAPIRequest: jest.fn(),
  executeAPIVoidRequest: jest.fn(),
  getAxios: jest.fn(),
}));

const completedState: CrossWorkspaceCopyTaskState = {
  job_id: 'job-id',
  status: 'Completed',
  retry_after_secs: 0,
  result: {
    duplicated_view_id: 'copied-view-id',
    dest_workspace_id: 'destination-workspace-id',
    operation: 'cross_workspace_copy',
    source_retained: true,
    warnings: [],
  },
};

describe('cross-workspace page copy API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('starts the v2 source-retaining copy with a stable idempotency key and Private destination', async () => {
    const post = jest.fn().mockResolvedValue({ data: { code: 0, data: completedState } });

    jest.mocked(getAxios).mockReturnValue({ post } as never);
    jest.mocked(executeAPIRequest).mockImplementation(async (request) => {
      const response = await request();

      return response?.data.data as CrossWorkspaceCopyTaskState;
    });

    await expect(
      copyPageToWorkspace('source-workspace-id', 'source-view-id', {
        dest_workspace_id: 'destination-workspace-id',
        idempotency_key: 'copy-action-id',
      })
    ).resolves.toEqual(completedState);

    expect(post).toHaveBeenCalledWith(
      '/api/workspace/source-workspace-id/page-view/source-view-id/copy-to-workspace/v2',
      {
        dest_workspace_id: 'destination-workspace-id',
        idempotency_key: 'copy-action-id',
        wait_for_completion: false,
      }
    );
    expect(post.mock.calls[0][1]).not.toHaveProperty('dest_parent_view_id');
  });

  it('polls the route-scoped v2 job and validates source retention', async () => {
    jest.useFakeTimers();
    const get = jest.fn().mockResolvedValue({ data: { code: 0, data: completedState } });

    jest.mocked(getAxios).mockReturnValue({ get } as never);
    jest.mocked(executeAPIRequest).mockImplementation(async (request) => {
      const response = await request();

      return response?.data.data as CrossWorkspaceCopyTaskState;
    });

    const pendingState: CrossWorkspaceCopyTaskState = {
      job_id: 'job-id',
      status: 'Pending',
      retry_after_secs: 1,
    };
    const resultPromise = waitForCrossWorkspaceCopyTask(
      'source-workspace-id',
      'source-view-id',
      pendingState
    );

    await jest.advanceTimersByTimeAsync(1_000);
    await expect(resultPromise).resolves.toEqual(completedState.result);
    expect(get).toHaveBeenCalledWith(
      '/api/workspace/source-workspace-id/page-view/source-view-id/copy-to-workspace/v2/job-id'
    );
  });

  it('continues polling after transient GET failures', async () => {
    jest.useFakeTimers();
    jest
      .mocked(executeAPIRequest)
      .mockRejectedValueOnce({ code: -1, message: 'Network error' })
      .mockRejectedValueOnce({ code: 503, httpStatus: 503, message: 'Unavailable' })
      .mockResolvedValueOnce(completedState);
    const pendingState: CrossWorkspaceCopyTaskState = {
      job_id: 'job-id',
      status: 'Running',
      retry_after_secs: 1,
    };
    const resultPromise = waitForCrossWorkspaceCopyTask(
      'source-workspace-id',
      'source-view-id',
      pendingState
    );

    await jest.advanceTimersByTimeAsync(3_000);
    await expect(resultPromise).resolves.toEqual(completedState.result);
    expect(executeAPIRequest).toHaveBeenCalledTimes(3);
  });

  it('does not retry permanent poll failures', async () => {
    jest.useFakeTimers();
    const permissionError = { code: 403, httpStatus: 403, message: 'Forbidden' };

    jest.mocked(executeAPIRequest).mockRejectedValueOnce(permissionError);
    const resultPromise = waitForCrossWorkspaceCopyTask('source-workspace-id', 'source-view-id', {
      job_id: 'job-id',
      status: 'Running',
      retry_after_secs: 1,
    });
    const rejection = expect(resultPromise).rejects.toBe(permissionError);

    await jest.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(executeAPIRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Failed', 'Worker failed'],
    ['Expired', 'Copy task expired'],
    ['Cancelled', 'Copy task was cancelled'],
  ] as const)('reports a server-confirmed %s task as a typed terminal error', async (status, message) => {
    const resultPromise = waitForCrossWorkspaceCopyTask('source-workspace-id', 'source-view-id', {
      job_id: 'job-id',
      status,
      retry_after_secs: 1,
      error: status === 'Failed' ? message : null,
    });

    await expect(resultPromise).rejects.toMatchObject({
      name: 'CrossWorkspaceCopyTerminalError',
      status,
      message,
    } satisfies Partial<CrossWorkspaceCopyTerminalError>);
  });

  it('rejects a completed task that does not prove the source was retained', async () => {
    await expect(
      waitForCrossWorkspaceCopyTask('source-workspace-id', 'source-view-id', {
        ...completedState,
        result: {
          ...completedState.result!,
          source_retained: false,
        } as never,
      })
    ).rejects.toThrow('incompatible result');
  });

  it('uses the v2 poll endpoint directly', async () => {
    const get = jest.fn();

    jest.mocked(getAxios).mockReturnValue({ get } as never);
    jest.mocked(executeAPIRequest).mockResolvedValue(completedState);

    await getCrossWorkspaceCopyTask('source-workspace-id', 'source-view-id', 'job-id');
    const request = jest.mocked(executeAPIRequest).mock.calls[0][0];

    await request();
    expect(get).toHaveBeenCalledWith(
      '/api/workspace/source-workspace-id/page-view/source-view-id/copy-to-workspace/v2/job-id'
    );
  });
});
