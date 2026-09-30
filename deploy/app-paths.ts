// App routes served as the SPA shell. `/auth` covers the OAuth callback
// (`/auth/callback#access_token=...`): it must never fall through to the
// publish-view lookup, which would serve the fallback landing page and lose
// the login tokens.
//
// Lives in its own module so the routes and the SSR indexing policy share one
// list: the policy refuses to server-render any namespace that collides with
// these paths, as a second line of defence behind route ordering.
export const APP_PATHS = ['/after-payment', '/login', '/auth', '/as-template', '/app', '/accept-invitation', '/import'];

// Matches whole path segments: '/auth' matches '/auth' and '/auth/callback'
// but not a publish namespace like '/authors'.
export const matchesAppPath = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);
