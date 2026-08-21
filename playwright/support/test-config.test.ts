import { generateRandomEmail } from './test-config';

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
