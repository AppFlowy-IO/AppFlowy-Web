import { resolveConfigValue } from '../runtime-config-value';

const BUILD = { APPFLOWY_BASE_URL: 'https://build.example.com', APPFLOWY_MCP_BASE_URL: 'http://localhost:8002' };

describe('resolveConfigValue', () => {
  it('prefers the injected runtime value, then the build, then the default', () => {
    expect(
      resolveConfigValue('APPFLOWY_BASE_URL', 'fallback', { APPFLOWY_BASE_URL: 'https://runtime.example.com' }, BUILD)
    ).toBe('https://runtime.example.com');
    expect(resolveConfigValue('APPFLOWY_BASE_URL', 'fallback', undefined, BUILD)).toBe('https://build.example.com');
    expect(resolveConfigValue('APPFLOWY_WS_BASE_URL', 'fallback', {}, BUILD)).toBe('fallback');
  });

  it('keeps an MCP override the deployment left empty, instead of one baked into the build', () => {
    // The Docker entrypoints inject an unset APPFLOWY_MCP_BASE_URL as '': use server-info, not a dev .env.
    expect(resolveConfigValue('APPFLOWY_MCP_BASE_URL', '', { APPFLOWY_MCP_BASE_URL: '' }, BUILD)).toBe('');
  });

  it('uses the build value for an MCP override the runtime config leaves out', () => {
    // Playwright and Vercel inject no key when it is unset, and `pnpm dev` injects nothing.
    expect(resolveConfigValue('APPFLOWY_MCP_BASE_URL', '', { APPFLOWY_BASE_URL: 'https://a' }, BUILD)).toBe(
      'http://localhost:8002'
    );
    expect(resolveConfigValue('APPFLOWY_MCP_BASE_URL', '', undefined, BUILD)).toBe('http://localhost:8002');
  });

  it('falls back to the build for an unsubstituted template or an empty required key', () => {
    expect(
      resolveConfigValue('APPFLOWY_MCP_BASE_URL', '', { APPFLOWY_MCP_BASE_URL: '${APPFLOWY_MCP_BASE_URL}' }, BUILD)
    ).toBe('http://localhost:8002');
    expect(resolveConfigValue('APPFLOWY_BASE_URL', 'fallback', { APPFLOWY_BASE_URL: '' }, BUILD)).toBe(
      'https://build.example.com'
    );
  });
});
