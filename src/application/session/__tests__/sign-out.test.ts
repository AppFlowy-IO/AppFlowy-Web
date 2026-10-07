import { clearRedirectTo } from '@/application/session/sign_in';
import { invalidToken } from '@/application/session/token';
import { Log } from '@/utils/log';

import { registerSignOutCleanup, signOutCurrentUser } from '../sign-out';

jest.mock('@/application/session/sign_in', () => ({ clearRedirectTo: jest.fn() }));
jest.mock('@/application/session/token', () => ({ invalidToken: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn() } }));

describe('signOutCurrentUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs the registered cleanups for the user, then clears the redirect and the token', () => {
    const order: string[] = [];

    jest.mocked(clearRedirectTo).mockImplementation(() => {
      order.push('redirect');
    });
    jest.mocked(invalidToken).mockImplementation(() => {
      order.push('token');
    });
    const cleanup = jest.fn((userId: string | number | null | undefined) => {
      order.push(`cleanup:${String(userId)}`);
    });
    const unregister = registerSignOutCleanup(cleanup);

    signOutCurrentUser('42');
    expect(order).toEqual(['cleanup:42', 'redirect', 'token']);

    unregister();
    signOutCurrentUser('42');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(invalidToken).toHaveBeenCalledTimes(2);
  });

  it('still ends the session when a cleanup throws', () => {
    const unregister = registerSignOutCleanup(() => {
      throw new Error('boom');
    });

    try {
      expect(() => signOutCurrentUser(undefined)).not.toThrow();
      expect(Log.warn).toHaveBeenCalledWith('[Session] a sign-out cleanup failed', expect.any(Error));
      expect(clearRedirectTo).toHaveBeenCalledTimes(1);
      expect(invalidToken).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });
});
