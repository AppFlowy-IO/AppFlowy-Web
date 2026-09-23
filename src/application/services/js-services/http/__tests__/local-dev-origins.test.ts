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

  it('keeps the configured base URL for production builds and remote servers', () => {
    expect(resolveLocalApiBaseURL('http://localhost:8000', false, 'http://localhost:3000')).toBe('http://localhost:8000');
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
