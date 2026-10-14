export const PROTOCOL = 'appflowy-youtube-v1';
export const REQUEST_TIMEOUT_MS = 90_000;
export const MAX_CONCURRENT_REQUESTS = 4;

export function isAppFlowyOrigin(value) {
  try {
    const url = new URL(value);

    if (url.username || url.password) return false;
    if (url.protocol === 'https:' && !url.port) {
      return ['beta.appflowy.cloud', 'test.appflowy.cloud'].includes(url.hostname);
    }

    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function validRequestId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}
