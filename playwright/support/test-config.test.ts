import { generateRandomEmail, runtimeConfigFromEnv } from './test-config';

describe('generateRandomEmail', () => {
  const originalReusableEmail = process.env.APPFLOWY_E2E_TEST_EMAIL;

  afterEach(() => {
    if (originalReusableEmail === undefined) {
      delete process.env.APPFLOWY_E2E_TEST_EMAIL;
    } else {
      process.env.APPFLOWY_E2E_TEST_EMAIL = originalReusableEmail;
    }
  });

  it('keeps identities unique when a legacy reusable email is configured', () => {
    process.env.APPFLOWY_E2E_TEST_EMAIL = 'shared@appflowy.io';

    const first = generateRandomEmail();
    const second = generateRandomEmail();

    expect(first).not.toBe('shared@appflowy.io');
    expect(second).not.toBe('shared@appflowy.io');
    expect(first).not.toBe(second);
  });

  it('uses the requested domain', () => {
    expect(generateRandomEmail('example.test')).toMatch(/^[0-9a-f-]+@example\.test$/);
  });
});

describe('runtimeConfigFromEnv', () => {
  const services = {
    APPFLOWY_BASE_URL: 'http://localhost:18180',
    APPFLOWY_GOTRUE_BASE_URL: 'http://localhost:18180/gotrue',
    APPFLOWY_WS_BASE_URL: 'ws://localhost:18180/ws/v2',
  };

  it('points the app at the three services and leaves the MCP origin to the app when unset', () => {
    expect(runtimeConfigFromEnv({ ...services, APPFLOWY_MCP_BASE_URL: '' })).toEqual({ config: services });
  });

  it('passes the MCP origin override on when set', () => {
    expect(runtimeConfigFromEnv({ ...services, APPFLOWY_MCP_BASE_URL: 'http://localhost:18180' })).toEqual({
      config: { ...services, APPFLOWY_MCP_BASE_URL: 'http://localhost:18180' },
    });
  });

  it('names the first service URL left unset', () => {
    expect(runtimeConfigFromEnv({ ...services, APPFLOWY_GOTRUE_BASE_URL: '' })).toEqual({
      missing: 'APPFLOWY_GOTRUE_BASE_URL',
    });
    expect(runtimeConfigFromEnv({ APPFLOWY_MCP_BASE_URL: 'http://localhost:8002' })).toEqual({
      missing: 'APPFLOWY_BASE_URL',
    });
  });
});
