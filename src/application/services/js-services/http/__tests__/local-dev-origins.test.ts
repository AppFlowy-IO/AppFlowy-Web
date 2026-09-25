import { isLocalDevBaseURL, resolveLocalApiBaseURL } from '../local-dev-origins';

describe('local development origins', () => {
  it('only treats a localhost base URL under the dev server as local development', () => {
    expect(isLocalDevBaseURL('http://localhost:8000', true)).toBe(true);
    expect(isLocalDevBaseURL('http://127.0.0.1:8000', true)).toBe(true);
    expect(isLocalDevBaseURL('https://beta.appflowy.cloud', true)).toBe(false);
    expect(isLocalDevBaseURL('http://localhost:8000', false)).toBe(false);
    expect(isLocalDevBaseURL('not a url', true)).toBe(false);
  });

  it('routes API requests through the dev server when developing against a local cloud', () => {
    expect(resolveLocalApiBaseURL('http://localhost:8000', true, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolveLocalApiBaseURL('http://localhost:8100', true, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolveLocalApiBaseURL('http://localhost:3000', true, 'http://localhost:3000')).toBe('http://localhost:3000');
  });

  it.each([8000, 8100])('routes IPv6 loopback on port %s through the dev server', (port) => {
    const baseURL = `http://[::1]:${port}`;

    expect(isLocalDevBaseURL(baseURL, true)).toBe(true);
    expect(resolveLocalApiBaseURL(baseURL, true, 'http://[::1]:3000')).toBe('http://[::1]:3000');
    expect(resolveLocalApiBaseURL(baseURL, true, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolveLocalApiBaseURL(baseURL, false, 'http://[::1]:3000')).toBe(baseURL);
    expect(resolveLocalApiBaseURL(baseURL, true, '')).toBe(baseURL);
  });

  it.each([
    'http://localhost',
    'http://localhost:80',
    'http://localhost:9001',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
    'https://localhost:8000',
    'http://localhost:8000/cloud',
  ])('preserves the configured backend outside the split-service setup: %s', (baseURL) => {
    expect(isLocalDevBaseURL(baseURL, true)).toBe(false);
    expect(resolveLocalApiBaseURL(baseURL, true, 'http://localhost:3000')).toBe(baseURL);
  });

  it('keeps the configured base URL for production builds and remote servers', () => {
    expect(resolveLocalApiBaseURL('http://localhost:8000', false, 'http://localhost:3000')).toBe(
      'http://localhost:8000'
    );
    expect(resolveLocalApiBaseURL('https://beta.appflowy.cloud', true, 'http://localhost:3000')).toBe(
      'https://beta.appflowy.cloud'
    );
    // No dev server origin known (for example outside a browser): keep the configured URL.
    expect(resolveLocalApiBaseURL('http://localhost:8000', true, '')).toBe('http://localhost:8000');
  });

  it('is inert under Jest, which is not the dev server', () => {
    expect(resolveLocalApiBaseURL('http://localhost:8000')).toBe('http://localhost:8000');
  });
});
