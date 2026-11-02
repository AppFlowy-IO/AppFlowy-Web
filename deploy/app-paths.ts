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

// The anti-framing headers of FRAME_DENY_PATHS. Each host sets them itself:
// deploy/routes.ts (the SSR image) from here, the `location ^~ /oauth/` block
// in docker/nginx.conf (the nginx-only image) and the `headers` entry in
// vercel.json. deploy/frame-deny.test.ts checks that the three agree.
export const FRAME_DENY_HEADERS: Readonly<Record<string, string>> = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

// Matches whole path segments: '/auth' matches '/auth' and '/auth/callback'
// but not a publish namespace like '/authors'.
export const matchesAppPath = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

// React Router percent-decodes each path segment before it matches a route
// (`decodePath` in @remix-run/router), keeping an encoded '/' as '%2F'.
const decodePathSegments = (pathname: string) => {
  try {
    return pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/');
  } catch {
    return pathname;
  }
};

// Whether the SPA may render a FRAME_DENY_PATHS page at `pathname`. Matched
// after decoding, like the SPA: `/%6Fauth/mcp/authorize` renders the consent
// page too. Case variants such as `/OAuth/...` never do: those routes are
// `caseSensitive` (src/components/main/MainAppRoutes.tsx).
export const isFrameDenyPath = (pathname: string) => {
  const decoded = decodePathSegments(pathname);

  return FRAME_DENY_PATHS.some((base) => matchesAppPath(decoded, base));
};
