// App routes served as the SPA shell. `/auth` covers the OAuth callback
// (`/auth/callback#access_token=...`): it must never fall through to the
// publish-view lookup, which would serve the fallback landing page and lose
// the login tokens. `/oauth` holds the MCP consent and setup pages
// (`/oauth/mcp/authorize`, `/oauth/mcp/setup`); see doc/MCP.md.
//
// Lives in its own module so the routes and the SSR indexing policy share one
// list: the policy refuses to server-render any namespace that collides with
// these paths, as a second line of defence behind route ordering.
export const APP_PATHS = [
  '/after-payment',
  '/login',
  '/auth',
  '/as-template',
  '/app',
  '/accept-invitation',
  '/import',
  '/oauth',
];

// App paths whose HTML must never be framed by another site. The MCP consent
// page grants an AI app access to the user's workspace, so framing it would
// allow clickjacking (RFC 9700 section 4.16).
export const FRAME_DENY_PATHS = ['/oauth'];

// Matches whole path segments: '/auth' matches '/auth' and '/auth/callback'
// but not a publish namespace like '/authors'.
export const matchesAppPath = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);
