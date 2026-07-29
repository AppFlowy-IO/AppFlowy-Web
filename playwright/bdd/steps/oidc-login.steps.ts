import { APIRequestContext, expect, Page, request as playwrightRequest } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { TestConfig } from '../../support/test-config';

const { Given, When, Then } = createBdd();

type ConfiguredProvider = {
  identifier: string;
  name: string;
};

/**
 * The provider this deployment has registered, or null when it has none.
 *
 * Read from the server rather than hardcoded: which providers exist is a
 * per-deployment decision, and a test that registered its own would overwrite
 * whatever a developer had configured.
 *
 * Memoized because it is a Background step — running it per scenario would mean
 * one request per scenario for a value that cannot change mid-run.
 */
let providerLookup: Promise<ConfiguredProvider | null> | undefined;

function configuredProvider(): Promise<ConfiguredProvider | null> {
  providerLookup ??= (async () => {
    let api: APIRequestContext | undefined;

    try {
      api = await playwrightRequest.newContext({ baseURL: TestConfig.apiUrl });
      const response = await api.get('/api/server-info/auth-providers', {
        failOnStatusCode: false,
      });

      if (!response.ok()) return null;

      const body = await response.json();
      const data = body?.data ?? {};
      const identifier = (data.providers ?? []).find((provider: string) =>
        provider.startsWith('custom:')
      );

      if (!identifier) return null;

      // The display name is what the button reads; fall back to the identifier
      // for a server that predates `custom_providers`.
      const named = (data.custom_providers ?? []).find(
        (provider: ConfiguredProvider) => provider.identifier === identifier
      );

      return { identifier, name: named?.name ?? identifier };
    } catch {
      return null;
    } finally {
      await api?.dispose();
    }
  })();

  return providerLookup;
}

async function requireProvider(): Promise<ConfiguredProvider> {
  const provider = await configuredProvider();

  expect(
    provider,
    'No custom OIDC provider is configured. Register one in the admin console — ' +
      '`just oidc-config` in AppFlowy-Cloud-Premium prints the values to use.'
  ).not.toBeNull();

  return provider!;
}

/**
 * Locates a provider button, expanding the collapsed group if needed.
 *
 * The provider list is fetched after page load, and `isVisible` does not wait,
 * so the group has to be on screen before deciding which branch applies. Skip
 * that wait and a deployment offering two providers or fewer never renders
 * "More options" at all, and this would block on a button that is never coming
 * while the one it wanted was already visible.
 *
 * Only the first two providers are shown inline; the rest sit behind
 * "More options".
 */
async function providerButton(page: Page, label: string) {
  const target = page.getByRole('button', { name: label });

  await page
    .getByRole('button', { name: /^Continue with/ })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });

  if (await target.isVisible().catch(() => false)) {
    return target;
  }

  const moreOptions = page.getByRole('button', { name: 'More options' });

  await moreOptions.waitFor({ state: 'visible', timeout: 15_000 });
  await moreOptions.click();
  await target.waitFor({ state: 'visible', timeout: 15_000 });

  return target;
}

Given('a custom OIDC provider is configured', async () => {
  await requireProvider();
});

When('I open the login page', async ({ page }) => {
  await page.goto(`${TestConfig.baseUrl}/login`);
  await page.waitForLoadState('domcontentloaded');
});

Then('the login page offers the configured OIDC provider', async ({ page }) => {
  const provider = await requireProvider();

  // Asserts the admin's chosen name, not the identifier: the server sends it so
  // a provider named "Okta Production" does not render as "Okta Prod".
  await expect(await providerButton(page, `Continue with ${provider.name}`)).toBeVisible();
});

When('I continue with the configured OIDC provider', async ({ page }) => {
  const provider = await requireProvider();
  const button = await providerButton(page, `Continue with ${provider.name}`);

  await button.click();
});

Then('the browser is handed to the identity provider', async ({ page }) => {
  // Anywhere off our own origin is the identity provider's territory; asserting
  // its exact host would tie this to one deployment's IdP.
  await page.waitForURL((url) => !url.href.startsWith(TestConfig.baseUrl), {
    timeout: 30_000,
  });

  expect(page.url()).toMatch(/^https:\/\//);
  expect(
    page.url(),
    'the identity provider rejected the authorize request'
  ).not.toContain('error=');
});

When(
  'I authenticate at the identity provider as {string} with password {string}',
  async ({ page }, username: string, password: string) => {
    await page.waitForURL((url) => !url.href.startsWith(TestConfig.baseUrl), {
      timeout: 30_000,
    });

    // Identity providers vary, so match on role rather than a bespoke selector.
    // Authentik asks for the identifier first and the password on a second step.
    const identifier = page.getByRole('textbox').first();

    await identifier.waitFor({ state: 'visible', timeout: 30_000 });
    await identifier.fill(username);
    await page.getByRole('button', { name: /log in|continue|next|sign in/i }).first().click();

    const passwordField = page.locator('input[type="password"]');

    await passwordField.waitFor({ state: 'visible', timeout: 30_000 });
    await passwordField.fill(password);
    await page.getByRole('button', { name: /log in|continue|next|sign in/i }).first().click();
  }
);

Then('I am signed in to AppFlowy', async ({ page }) => {
  // Back on our origin, past /login: the callback exchanged the code and
  // established the session.
  await page.waitForURL(
    (url) => url.href.startsWith(TestConfig.baseUrl) && !url.pathname.startsWith('/login'),
    { timeout: 60_000 }
  );

  expect(page.url()).toContain('/app');
});
