/**
 * The URL contract of the MCP consent page: where it lives and how its
 * "request expired" view is addressed. The MCP service redirects browsers to
 * `MCP_CONSENT_PATH`, and the hosts frame-protect it (deploy/app-paths.ts), so
 * a path change goes there too. Side-effect free: the session module, the
 * router and the consent page all import it.
 */

/** The MCP OAuth consent page (`src/pages/McpAuthorizePage.tsx`). */
export const MCP_CONSENT_PATH = '/oauth/mcp/authorize';

/** Query parameter of the consent page's "request expired" view (`?expired=1[&client_id=…]`). */
const MCP_CONSENT_EXPIRED_PARAM = 'expired';

/**
 * The consent page's "request expired" view, where a sign-in lands when it
 * outlived the consent request it started from. Only the client ID travels
 * along, to name the app.
 */
export function buildMcpConsentExpiredPath(consentUrl?: string | null): string {
  const search = new URLSearchParams({ [MCP_CONSENT_EXPIRED_PARAM]: '1' });
  let clientId: string | null = null;

  try {
    clientId = consentUrl ? new URL(consentUrl, window.location.origin).searchParams.get('client_id') : null;
  } catch {
    clientId = null;
  }

  if (clientId) search.set('client_id', clientId);
  return `${MCP_CONSENT_PATH}?${search.toString()}`;
}

/**
 * The "request expired" view `buildMcpConsentExpiredPath` addresses; null for
 * any other consent URL. Checked before `parseMcpConsentRequest`.
 */
export function parseMcpConsentExpired(search: URLSearchParams): { clientId?: string } | null {
  if (search.get(MCP_CONSENT_EXPIRED_PARAM) !== '1') return null;

  const clientId = search.get('client_id')?.trim();

  return { clientId: clientId || undefined };
}
