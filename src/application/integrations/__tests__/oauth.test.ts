import * as IntegrationService from '@/application/services/domains/integration';

import { authorizeIntegration, INTEGRATION_OAUTH_CALLBACK, INTEGRATION_OAUTH_REQUEST } from '../oauth';

jest.mock('@/application/services/domains/integration', () => ({ connectProvider: jest.fn() }));

const connectProvider = jest.mocked(IntegrationService.connectProvider);
const callbackOrigin = 'https://cloud.example.com';
const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?state=server-state&redirect_uri=${encodeURIComponent(
  `${callbackOrigin}/api/integrations/connections/oauth/callback`
)}`;

describe('integration OAuth popup', () => {
  let popup: Window;
  let controller: AbortController;

  function callback(query = 'code=authorization-code&state=server-state', origin = callbackOrigin, source = popup) {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin,
        source,
        data: { type: INTEGRATION_OAUTH_CALLBACK, oauth_query: query },
      })
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    controller = new AbortController();
    popup = {
      closed: false,
      close: jest.fn(),
      postMessage: jest.fn(),
      location: { href: 'about:blank' },
    } as unknown as Window;
    jest.spyOn(window, 'open').mockReturnValue(popup);
    connectProvider.mockResolvedValue({ oauth_url: oauthUrl, connection_id: 'connection-id' });
  });

  afterEach(() => {
    controller.abort();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('opens before requesting the URL and accepts only the expected popup, origin, and state', async () => {
    const result = authorizeIntegration('workspace', 'google-drive', controller.signal);

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank', expect.any(String));
    expect(jest.mocked(window.open).mock.invocationCallOrder[0]).toBeLessThan(
      connectProvider.mock.invocationCallOrder[0]
    );
    await Promise.resolve();
    expect(popup.location.href).toBe(oauthUrl);
    jest.advanceTimersByTime(500);
    expect(popup.postMessage).toHaveBeenCalledWith(
      { type: INTEGRATION_OAUTH_REQUEST, state: 'server-state' },
      callbackOrigin
    );

    const resolved = jest.fn();

    void result.then(resolved);
    callback(undefined, 'https://untrusted.example.com');
    callback(undefined, callbackOrigin, window);
    callback('code=code&state=another-attempt');
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();

    callback('code=valid-code&state=server-state&scope=drive');
    callback('code=duplicate&state=server-state');
    await expect(result).resolves.toEqual({
      connectionId: 'connection-id',
      oauthQuery: 'code=valid-code&state=server-state&scope=drive',
    });
    expect(popup.close).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not create an integration when the browser blocks the popup', async () => {
    jest.mocked(window.open).mockReturnValue(null);
    await expect(authorizeIntegration('workspace', 'google-drive', controller.signal)).rejects.toMatchObject({
      code: 'popupBlocked',
    });
    expect(connectProvider).not.toHaveBeenCalled();
  });

  it('rejects denied authorization and never returns an OAuth query to confirm', async () => {
    const result = authorizeIntegration('workspace', 'google-calendar', controller.signal);

    await Promise.resolve();
    callback('error=access_denied&state=server-state');
    await expect(result).rejects.toMatchObject({ code: 'authorizationDenied' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels when the popup closes', async () => {
    const result = authorizeIntegration('workspace', 'google-drive', controller.signal);

    await Promise.resolve();
    Object.defineProperty(popup, 'closed', { value: true });
    jest.advanceTimersByTime(500);
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out and removes the callback listener', async () => {
    const result = authorizeIntegration('workspace', 'google-drive', controller.signal);

    await Promise.resolve();
    jest.advanceTimersByTime(120_000);
    await expect(result).rejects.toMatchObject({ code: 'timedOut' });
    callback();
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts when settings closes and ignores a later callback', async () => {
    const result = authorizeIntegration('workspace', 'google-drive', controller.signal);

    await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    callback();
    expect(popup.close).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not navigate if settings closes while the connect request is pending', async () => {
    let resolve!: (response: { oauth_url: string; connection_id: string }) => void;

    connectProvider.mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res;
        })
    );
    const result = authorizeIntegration('workspace', 'google-drive', controller.signal);

    controller.abort();
    expect(popup.close).toHaveBeenCalled();
    resolve({ oauth_url: oauthUrl, connection_id: 'connection-id' });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(popup.location.href).toBe('about:blank');
  });

  it('rejects an unsafe OAuth URL and closes the popup on API errors', async () => {
    connectProvider.mockResolvedValueOnce({ oauth_url: 'javascript:alert(1)', connection_id: 'id' });
    await expect(authorizeIntegration('workspace', 'google-drive', controller.signal)).rejects.toMatchObject({
      code: 'invalidResponse',
    });
    connectProvider.mockRejectedValueOnce(new Error('Service unavailable'));
    await expect(authorizeIntegration('workspace', 'google-drive', controller.signal)).rejects.toThrow(
      'Service unavailable'
    );
    expect(popup.close).toHaveBeenCalledTimes(2);
  });
});
