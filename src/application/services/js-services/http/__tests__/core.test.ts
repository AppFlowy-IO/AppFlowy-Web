import { ERROR_CODE } from '@/application/constants';

import { withRetry } from '../core';

describe('withRetry', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries AppFlowy TooManyRequests API errors', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const request = jest
      .fn()
      .mockRejectedValueOnce({
        code: ERROR_CODE.TOO_MANY_REQUESTS,
        message: 'permission resolver is busy',
      })
      .mockResolvedValueOnce('ok');

    const promise = withRetry(request, { delays: [1] });

    await Promise.resolve();
    jest.advanceTimersByTime(1);

    await expect(promise).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
