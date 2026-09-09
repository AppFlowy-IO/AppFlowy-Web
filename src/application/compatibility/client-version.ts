import policy from './web-server-compatibility.json';

// Embedded in the bundle: a stale browser tab must keep reporting the version it loaded.
export const WEB_CLIENT_VERSION =
  typeof __APPFLOWY_WEB_VERSION__ === 'string' ? __APPFLOWY_WEB_VERSION__ : policy.reviewed_through_client_version;
