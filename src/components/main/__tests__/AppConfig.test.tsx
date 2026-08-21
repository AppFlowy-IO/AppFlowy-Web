import { act, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';

import { UserService } from '@/application/services/domains';
import { clearHttpResponseCaches } from '@/application/services/js-services/http/core';
import { emit, EventType } from '@/application/session';
import { AFConfigContext } from '@/components/main/app.hooks';
import { useUserTimezone } from '@/components/main/hooks/useUserTimezone';

import AppConfig from '../AppConfig';

let mockTokenValid = false;
let mockUserId: string | undefined = 'user-1';

jest.mock('dexie-react-hooks', () => ({
  useLiveQuery: jest.fn(() => undefined),
}));

jest.mock('notistack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: jest.fn(),
    closeSnackbar: jest.fn(),
  }),
}));

jest.mock('@/application/db', () => ({
  clearData: jest.fn(),
  db: {
    users: {
      get: jest.fn(),
      put: jest.fn(),
    },
  },
}));

jest.mock('@/application/services/domains', () => ({
  UserService: {
    getCurrent: jest.fn(),
    updateProfile: jest.fn(),
  },
}));

jest.mock('@/application/services/js-services/http/core', () => ({
  clearHttpResponseCaches: jest.fn(),
  initAPIService: jest.fn(),
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(() =>
    mockTokenValid
      ? {
          access_token: 'access-token',
          expires_at: 1,
          refresh_token: 'refresh-token',
          user: mockUserId ? { id: mockUserId, email: 'person@example.com' } : undefined,
        }
      : null
  ),
  isTokenValid: jest.fn(() => mockTokenValid),
}));

jest.mock('@/components/main/hooks/useUserTimezone', () => ({
  useUserTimezone: jest.fn(),
}));

jest.mock('@/components/main/useAppLanguage', () => ({
  useAppLanguage: jest.fn(),
}));

jest.mock('@/utils/log', () => ({
  Log: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

function AuthenticationState() {
  const config = useContext(AFConfigContext);

  return (
    <>
      <div data-testid='authentication-state'>{String(config?.isAuthenticated)}</div>
      <div data-testid='authenticated-user-id'>{config?.authenticatedUserId ?? 'none'}</div>
    </>
  );
}

describe('AppConfig authentication startup', () => {
  const mockGetCurrent = UserService.getCurrent as jest.MockedFunction<typeof UserService.getCurrent>;
  const mockUpdateProfile = UserService.updateProfile as jest.MockedFunction<typeof UserService.updateProfile>;
  const mockUseUserTimezone = useUserTimezone as jest.MockedFunction<typeof useUserTimezone>;
  const mockClearHttpResponseCaches = clearHttpResponseCaches as jest.MockedFunction<typeof clearHttpResponseCaches>;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockTokenValid = false;
    mockUserId = 'user-1';
    mockUseUserTimezone.mockReturnValue({
      timezone: 'Asia/Shanghai',
      offset: 480,
      offsetString: 'UTC+08:00',
      locale: 'en-US',
    });
    mockGetCurrent.mockImplementation(
      async () =>
        ({
          uuid: mockUserId,
          email: 'person@example.com',
          name: 'Person',
          metadata: {},
        } as never)
    );
    mockUpdateProfile.mockResolvedValue(undefined as never);
  });

  it('uses one profile request for startup caching and timezone initialization', async () => {
    mockTokenValid = true;

    render(
      <AppConfig>
        <AuthenticationState />
      </AppConfig>
    );

    expect(screen.getByTestId('authentication-state').textContent).toBe('true');
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));

    expect(mockGetCurrent).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: expect.objectContaining({ default_timezone: 'Asia/Shanghai' }),
      })
    );
  });

  it('reacts to a same-tab invalidation without delayed token polling', async () => {
    mockTokenValid = true;

    render(
      <AppConfig>
        <AuthenticationState />
      </AppConfig>
    );

    expect(screen.getByTestId('authentication-state').textContent).toBe('true');

    act(() => {
      emit(EventType.SESSION_INVALID);
    });

    expect(screen.getByTestId('authentication-state').textContent).toBe('false');
    expect(mockClearHttpResponseCaches).toHaveBeenCalledTimes(1);
  });

  it('synchronizes a login performed in another tab from the token storage event', async () => {
    render(
      <AppConfig>
        <AuthenticationState />
      </AppConfig>
    );

    expect(screen.getByTestId('authentication-state').textContent).toBe('false');

    mockTokenValid = true;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
    });

    expect(screen.getByTestId('authentication-state').textContent).toBe('true');
    await waitFor(() => expect(mockGetCurrent).toHaveBeenCalledTimes(1));
  });

  it('refreshes user-scoped state when another tab switches accounts', async () => {
    mockTokenValid = true;

    render(
      <AppConfig>
        <AuthenticationState />
      </AppConfig>
    );

    await waitFor(() => expect(mockGetCurrent).toHaveBeenCalledTimes(1));

    mockUserId = 'user-2';
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
    });

    await waitFor(() => expect(mockGetCurrent).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('authenticated-user-id').textContent).toBe('user-2');
    expect(mockClearHttpResponseCaches).toHaveBeenCalledTimes(1);
  });

  it('clears user-scoped caches for a cross-tab token replacement without user claims', async () => {
    mockTokenValid = true;

    render(
      <AppConfig>
        <AuthenticationState />
      </AppConfig>
    );

    await waitFor(() => expect(mockGetCurrent).toHaveBeenCalledTimes(1));

    mockUserId = undefined;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }));
    });

    expect(screen.getByTestId('authenticated-user-id').textContent).toBe('none');
    expect(mockClearHttpResponseCaches).toHaveBeenCalledTimes(1);
  });
});
