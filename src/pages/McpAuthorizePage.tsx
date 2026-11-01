import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { getMcpClientDisplayName } from '@/application/mcp/setup';
import { getMcpClientInfo, type McpConfiguration } from '@/application/services/domains/mcp';
import { buildLoginUrl, saveMcpConsentRedirectTo } from '@/application/session/sign_in';
import { useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { isConsentFramed, parseMcpConsentExpired, parseMcpConsentRequest } from '@/components/mcp/consent/consentModel';
import { McpConsentFlow } from '@/components/mcp/consent/McpConsentFlow';
import { McpConsentLoading } from '@/components/mcp/consent/McpConsentLayout';
import {
  McpConsentErrorView,
  McpConsentExpiredView,
  McpConsentFramedView,
} from '@/components/mcp/consent/McpConsentStateViews';
import { useMcpConfiguration } from '@/components/mcp/useMcpConfiguration';
import { Log } from '@/utils/log';

/**
 * MCP OAuth consent (`/oauth/mcp/authorize`). The MCP service redirects the
 * browser here with the client's authorization request; the user picks a
 * workspace and permissions and the page asks the MCP service for the
 * authorization code (or the validated `access_denied` redirect). See
 * doc/MCP.md and AppFlowy Cloud's doc/context/integrations/mcp_context.md.
 */
export default function McpAuthorizePage() {
  // Decided once: a framed page loads nothing and never redirects.
  const [framed] = useState(isConsentFramed);

  if (framed) return <McpConsentFramedView />;
  return <McpAuthorizeRequest />;
}

function McpAuthorizeRequest() {
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthenticated = useIsAuthenticatedOptional();
  // Without APPFLOWY_MCP_BASE_URL, the MCP service's URL comes from Cloud server-info.
  const configuration = useMcpConfiguration({ loadServerInfo: true });
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const expired = useMemo(() => parseMcpConsentExpired(search), [search]);
  const request = useMemo(() => (expired ? null : parseMcpConsentRequest(search)), [expired, search]);
  const returnTo = `${location.pathname}${location.search}`;
  const loginStartedRef = useRef(false);

  // Password, magic link, SSO, OIDC, SAML and LDAP sign-in all come back to
  // this request, as long as it is still valid.
  const goToLogin = useCallback(() => {
    if (loginStartedRef.current) return;
    loginStartedRef.current = true;
    // The request stays out of the login URL and out of persistent storage:
    // this tab's session storage keeps it behind an opaque flow ID for as long
    // as the MCP service keeps the authorization request.
    if (!saveMcpConsentRedirectTo(returnTo)) {
      Log.warn('[MCP] Session storage is unavailable; sign-in will not return to this request');
    }

    navigate(buildLoginUrl({ redirectTo: returnTo }), { replace: true });
  }, [navigate, returnTo]);

  const mustSignIn = request !== null && configuration.status === 'configured' && !isAuthenticated;

  useEffect(() => {
    if (mustSignIn) goToLogin();
  }, [goToLogin, mustSignIn]);

  if (expired) return <McpConsentExpired clientId={expired.clientId} configuration={configuration} />;
  if (!request) return <McpConsentErrorView reason='invalid_request' />;
  if (configuration.status === 'loading') return <McpConsentLoading />;
  if (configuration.status === 'not_configured') return <McpConsentErrorView reason='not_configured' />;
  if (!isAuthenticated) return <McpConsentLoading />;

  return <McpConsentFlow key={location.search} request={request} onLoginRequired={goToLogin} />;
}

/** The "request expired" view, naming the app once its public description loads. */
function McpConsentExpired({ clientId, configuration }: { clientId?: string; configuration: McpConfiguration }) {
  const baseUrl = configuration.status === 'configured' ? configuration.baseUrl : undefined;
  const lookup = clientId && baseUrl ? `${baseUrl} ${clientId}` : undefined;
  const [resolved, setResolved] = useState<{ lookup: string; name?: string }>();

  useEffect(() => {
    if (!clientId || !lookup) return;

    const controller = new AbortController();

    getMcpClientInfo(clientId, { signal: controller.signal }).then(
      (client) => {
        if (!controller.signal.aborted) setResolved({ lookup, name: getMcpClientDisplayName(client) });
      },
      () => {
        // An unknown or unreachable client still gets the view, without its name.
        if (!controller.signal.aborted) setResolved({ lookup });
      }
    );

    return () => controller.abort();
  }, [clientId, lookup]);

  if (configuration.status === 'loading' || (lookup && resolved?.lookup !== lookup)) return <McpConsentLoading />;
  return <McpConsentExpiredView name={lookup ? resolved?.name : undefined} />;
}
