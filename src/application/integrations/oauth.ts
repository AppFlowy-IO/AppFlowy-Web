import * as IntegrationService from '@/application/services/domains/integration';

import { IntegrationProvider } from './types';

export const INTEGRATION_OAUTH_REQUEST = 'appflowy:integration-oauth-request';
export const INTEGRATION_OAUTH_CALLBACK = 'appflowy:integration-oauth-callback';
const AUTHORIZATION_TIMEOUT_MS = 120_000;

export class IntegrationOAuthError extends Error {
  constructor(
    public readonly code: 'popupBlocked' | 'cancelled' | 'timedOut' | 'invalidResponse' | 'authorizationDenied'
  ) {
    super(code);
    this.name = 'IntegrationOAuthError';
  }
}

/** Opens synchronously from the user's click so browsers do not block the popup. */
export async function authorizeIntegration(
  workspaceId: string,
  provider: IntegrationProvider,
  signal: AbortSignal
): Promise<{ connectionId: string; oauthQuery: string }> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const popup = window.open('about:blank', '_blank', 'popup,width=600,height=720');

  if (!popup) throw new IntegrationOAuthError('popupBlocked');

  // Also close while the initial HTTP request is pending, including on unmount.
  const closePopup = () => popup.close();

  signal.addEventListener('abort', closePopup, { once: true });
  try {
    const response = await IntegrationService.connectProvider(workspaceId, provider, signal);

    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    let oauthUrl: URL;
    let callbackUrl: URL;

    try {
      oauthUrl = new URL(response.oauth_url);
      callbackUrl = new URL(oauthUrl.searchParams.get('redirect_uri') || '');
    } catch {
      throw new IntegrationOAuthError('invalidResponse');
    }

    const expectedState = oauthUrl.searchParams.get('state');

    if (
      !expectedState ||
      !response.connection_id ||
      !/^https?:$/.test(oauthUrl.protocol) ||
      !/^https?:$/.test(callbackUrl.protocol)
    ) {
      throw new IntegrationOAuthError('invalidResponse');
    }

    const callbackOrigin = callbackUrl.origin;

    const oauthQuery = await new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, query?: string) => {
        window.removeEventListener('message', onMessage);
        signal.removeEventListener('abort', onAbort);
        window.clearInterval(poll);
        window.clearTimeout(timeout);
        if (error) reject(error);
        else resolve(query!);
      };

      const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
      const onMessage = (event: MessageEvent) => {
        // The OAuth callback is hosted by Cloud, which may be a different origin.
        // Bind it to this popup and the server-issued state before consuming it.
        if (event.source !== popup || event.origin !== callbackOrigin) return;
        if (event.data?.type !== INTEGRATION_OAUTH_CALLBACK || typeof event.data.oauth_query !== 'string') return;

        const query = new URLSearchParams(event.data.oauth_query);

        if (query.get('state') !== expectedState) return;
        if (query.has('error')) return finish(new IntegrationOAuthError('authorizationDenied'));
        if (!query.get('code')) return finish(new IntegrationOAuthError('invalidResponse'));
        finish(undefined, event.data.oauth_query);
      };

      const poll = window.setInterval(() => {
        if (popup.closed) {
          finish(new IntegrationOAuthError('cancelled'));
          return;
        }

        // Only the trusted callback origin receives the challenge. Cloud replies
        // to our exact origin after verifying the opener knows the OAuth state.
        popup.postMessage({ type: INTEGRATION_OAUTH_REQUEST, state: expectedState }, callbackOrigin);
      }, 500);
      const timeout = window.setTimeout(() => finish(new IntegrationOAuthError('timedOut')), AUTHORIZATION_TIMEOUT_MS);

      window.addEventListener('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        popup.location.href = oauthUrl.href;
      } catch {
        finish(new IntegrationOAuthError('invalidResponse'));
      }
    });

    return { connectionId: response.connection_id, oauthQuery };
  } finally {
    signal.removeEventListener('abort', closePopup);
    closePopup();
  }
}
