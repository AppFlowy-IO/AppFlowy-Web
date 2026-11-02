import type { APIRequestContext } from '@playwright/test';

import { apiPost } from './dashboard-shared-helpers';

jest.mock('@playwright/test', () => ({ expect }));

function response(code: number, message: string, data?: unknown) {
  return { ok: () => true, status: () => 200, text: async () => JSON.stringify({ code, message, data }) };
}

it.each([
  [-5, 'Database dashboard admission for database in workspace workspace changed; retry later'],
  [1017, 'Internal server error'],
])('does not repeat a view-creation response that may follow committed metadata (%s)', async (code, message) => {
  const post = jest.fn().mockResolvedValue(response(code as number, message as string));

  await expect(apiPost({ post } as unknown as APIRequestContext, 'token', '/api/workspace/workspace/page-view/view/database-view', {}))
    .rejects.toThrow(message as string);
  expect(post).toHaveBeenCalledTimes(1);
});

it('can retry permission-mapping admission before the request runs', async () => {
  jest.useFakeTimers();
  try {
    const post = jest.fn()
      .mockResolvedValueOnce(response(1079, 'Too many requests'))
      .mockResolvedValueOnce(response(0, '', { view_id: 'created' }));
    const result = apiPost({ post } as unknown as APIRequestContext, 'token', '/api/workspace/workspace/page-view/view/database-view', {});

    await jest.runAllTimersAsync();
    await expect(result).resolves.toEqual({ view_id: 'created' });
    expect(post).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
