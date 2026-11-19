import { readFile } from 'node:fs/promises';

import { expect, Page } from '@playwright/test';

const provider = 'https://provider.drive.test';
const cloud = 'https://cloud.drive.test';

/** Only provider/Cloud HTTP is mocked: production popup messaging, confirmation,
 * account refresh and the block's picker handoff run unchanged. */
export async function mockDriveAuthorization(
  page: Page,
  initialAccounts: { id: string; provider: string; status: string; account_identifier: string }[] = []
) {
  const callbackHTML = await readFile(new URL('./fixtures/oauth_callback.html', import.meta.url), 'utf8');
  const state = { accounts: [...initialAccounts], starts: 0, confirmations: 0 };
  const account = { id: 'new-drive', provider: 'google-drive', status: 'active', account_identifier: 'new@example.com' };

  await page.route('**/api/integrations/connections?*', (route) =>
    route.fulfill({ json: { code: 0, data: { connections: state.accounts } } })
  );
  await page.route('**/api/integrations/connect/google-drive', (route) => {
    state.starts++;
    expect(route.request().postDataJSON()).toEqual({ workspace_id: '00000000-0000-4000-8000-000000000001' });
    const oauthURL = new URL('/authorize', provider);

    oauthURL.search = new URLSearchParams({ state: `drive-state-${state.starts}`, redirect_uri: `${cloud}/callback` }).toString();
    return route.fulfill({ json: { code: 0, data: { connection_id: account.id, oauth_url: oauthURL.href } } });
  });
  await page.context().route(`${provider}/authorize?*`, (route) => {
    const oauthState = new URL(route.request().url()).searchParams.get('state');

    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><form action="${cloud}/callback"><input type="hidden" name="code" value="test-code"><input type="hidden" name="state" value="${oauthState}"><button>Allow access</button></form>`,
    });
  });
  await page.context().route(`${cloud}/callback?*`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: callbackHTML.replace('{{OAUTH_QUERY}}', encodeURIComponent(new URL(route.request().url()).search.slice(1))),
    })
  );
  await page.route('**/api/integrations/connections/callback', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      workspace_id: '00000000-0000-4000-8000-000000000001',
      provider: 'google-drive',
      connection_id: account.id,
      oauth_query: `code=test-code&state=drive-state-${state.starts}`,
    });
    state.confirmations++;
    state.accounts.push(account);
    return route.fulfill({ json: { code: 0, data: { success: true, connection: account } } });
  });
  return state;
}

export async function startDriveAuthorization(page: Page, button = 'Connect Google Account') {
  const opened = page.waitForEvent('popup');

  await page.getByRole('button', { name: button, exact: true }).click();
  const popup = await opened;

  await expect(popup.getByRole('button', { name: 'Allow access' })).toBeVisible();
  await expect(page.getByText('Complete authorization in the browser window.')).toBeVisible();
  return popup;
}

export async function completeDriveAuthorization(popup: Page) {
  await Promise.all([popup.waitForEvent('close'), popup.getByRole('button', { name: 'Allow access' }).click()]);
}
