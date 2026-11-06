import { buildMcpConsentExpiredPath, MCP_CONSENT_PATH, parseMcpConsentExpired } from '../consentUrl';

const CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CONSENT_URL =
  `${MCP_CONSENT_PATH}?client_id=${encodeURIComponent(CLIENT_ID)}` +
  '&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&response_type=code' +
  '&code_challenge=challenge&code_challenge_method=S256&state=state-1';

function searchOf(path: string): URLSearchParams {
  return new URL(path, window.location.origin).searchParams;
}

describe('MCP consent URL', () => {
  it('lives where the MCP service sends browsers', () => {
    // AppFlowy Cloud's MCP service redirects to this path, and hosts frame-protect it.
    expect(MCP_CONSENT_PATH).toBe('/oauth/mcp/authorize');
  });

  it('builds an expired view that names only the app', () => {
    const path = buildMcpConsentExpiredPath(CONSENT_URL);

    expect(path).toBe(`${MCP_CONSENT_PATH}?expired=1&client_id=${encodeURIComponent(CLIENT_ID)}`);
    expect(path).not.toMatch(/redirect_uri|code_challenge|state-1/);
  });

  it.each([
    ['a consent request', CONSENT_URL, { clientId: CLIENT_ID }],
    ['a request without a client ID', `${MCP_CONSENT_PATH}?response_type=code`, { clientId: undefined }],
    ['no request', null, { clientId: undefined }],
  ])('reads back the expired view it builds for %s', (_case, consentUrl, expected) => {
    expect(parseMcpConsentExpired(searchOf(buildMcpConsentExpiredPath(consentUrl)))).toEqual(expected);
  });

  it('ignores a blank client ID', () => {
    expect(parseMcpConsentExpired(new URLSearchParams('expired=1&client_id=%20'))).toEqual({ clientId: undefined });
  });

  it('is null for a consent request', () => {
    expect(parseMcpConsentExpired(searchOf(CONSENT_URL))).toBeNull();
    expect(parseMcpConsentExpired(new URLSearchParams('expired=true'))).toBeNull();
  });
});
