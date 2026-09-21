import { expect, type Page } from '@playwright/test';

import { allowConnection, CALLBACK_PATH, CLOUD_ORIGIN, startConnection, test } from '../../support/connections';

for (const provider of ['google-drive', 'google-calendar'] as const) {
  test(`${provider}: consent connects once, fetches account details and survives reload`, async ({
    page,
    connectionApp,
  }) => {
    await connectionApp.open();
    const popup = await startConnection(page, provider);

    expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
    await allowConnection(popup);
    await expect(page.getByRole('row', { name: new RegExp(`${provider}-1@example.test`) })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toBeEnabled();
    const authorization = connectionApp.authorizations[0];
    const confirmations = connectionApp.requests.filter((request) => new URL(request.url()).pathname === CALLBACK_PATH);

    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].postDataJSON().connection_id).toBe(authorization.id);
    await expect
      .poll(() => connectionApp.requests.filter((request) => request.url().endsWith('/api/integrations/proxy')).length)
      .toBe(1);

    await page.reload();
    await expect(page.getByTestId(`connection-${authorization.id}`)).toContainText(`${provider}-1@example.test`);
    expect(connectionApp.authorizations).toHaveLength(1);
    await expect
      .poll(() => connectionApp.requests.filter((request) => request.url().endsWith('/api/integrations/proxy')).length)
      .toBe(2);
  });
}

test('declined consent shows an error and a fresh authorization can succeed', async ({ page, connectionApp }) => {
  await connectionApp.open();
  const denied = await startConnection(page, 'google-drive');
  const closed = denied.waitForEvent('close');

  await denied.getByRole('button', { name: 'Deny access' }).click();
  await closed;
  await expect(page.getByRole('alert')).toHaveText('Authorization was declined. Please try again and allow access.');
  expect(connectionApp.requests.filter((request) => request.url().endsWith(CALLBACK_PATH))).toHaveLength(0);
  expect(connectionApp.connections).toHaveLength(0);

  await allowConnection(await startConnection(page, 'google-drive'));
  await expect(page.getByText('google-drive-1@example.test', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
  expect(connectionApp.authorizations[0].state).not.toBe(connectionApp.authorizations[1].state);
});

for (const action of ['close popup', 'cancel', 'close settings'] as const) {
  test(`${action} releases the pending connection and allows retry`, async ({ page, connectionApp }) => {
    await connectionApp.open();
    const popup = await startConnection(page, 'google-calendar');
    const closed = popup.waitForEvent('close');

    if (action === 'close popup') await popup.close();
    else if (action === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await closed;
    if (action === 'close settings') await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toBeHidden();
    expect(connectionApp.requests.filter((request) => request.url().endsWith(CALLBACK_PATH))).toHaveLength(0);

    await allowConnection(await startConnection(page, 'google-calendar'));
    await expect(page.getByText('google-calendar-1@example.test', { exact: true })).toBeVisible();
  });
}

test('OAuth timeout closes the popup and offers a fresh attempt', async ({ page, connectionApp }) => {
  await page.clock.install();
  await connectionApp.open();
  const popup = await startConnection(page, 'google-drive');

  await page.clock.fastForward('02:01');
  await expect(page.getByRole('alert')).toHaveText('The connection timed out. Please try again.');
  expect(popup.isClosed()).toBe(true);
  expect(connectionApp.requests.filter((request) => request.url().endsWith(CALLBACK_PATH))).toHaveLength(0);
  await allowConnection(await startConnection(page, 'google-drive'));
  await expect(page.getByText('google-drive-1@example.test', { exact: true })).toBeVisible();
});

test('a blocked popup gives actionable guidance without starting a server connection', async ({
  page,
  connectionApp,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await connectionApp.open();
  await page.getByTestId('connect-google-drive').click();
  await expect(page.getByRole('alert')).toHaveText('Allow pop-ups for AppFlowy, then try connecting again.');
  await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toBeEnabled();
  expect(connectionApp.authorizations).toHaveLength(0);
  expect(connectionApp.connections).toHaveLength(0);
});

// Wait for a real browser MessageEvent before checking that it was rejected.
// Creating a synthetic MessageEvent would let the test forge origin/source itself.
async function sendCallback(opener: Page, sender: Page, query: string) {
  const received = opener.evaluate(
    () =>
      new Promise<void>((resolve) => window.addEventListener('message', () => setTimeout(resolve, 0), { once: true }))
  );

  await sender.evaluate(
    ({ query, targetOrigin }) =>
      window.opener.postMessage({ type: 'appflowy:integration-oauth-callback', oauth_query: query }, targetOrigin),
    { query, targetOrigin: new URL(opener.url()).origin }
  );
  await received;
}

for (const attack of ['wrong origin', 'wrong window', 'wrong state'] as const) {
  test(`rejects a callback from the ${attack} while the valid popup can still finish`, async ({
    page,
    connectionApp,
  }) => {
    await connectionApp.open();
    const popup = await startConnection(page, 'google-drive');
    const providerURL = popup.url();
    const { code, state } = connectionApp.authorizations[0];
    let sender = popup;

    if (attack === 'wrong window') {
      const opened = page.waitForEvent('popup');

      await page.evaluate((url) => {
        window.open(url, '_blank');
      }, `${CLOUD_ORIGIN}/message-test`);
      sender = await opened;
      await sender.waitForLoadState();
    } else if (attack === 'wrong state') {
      await popup.goto(`${CLOUD_ORIGIN}/message-test`);
    }

    await sendCallback(
      page,
      sender,
      new URLSearchParams({ code, state: attack === 'wrong state' ? 'stale-state' : state }).toString()
    );
    await expect(page.getByText('Complete authorization in the browser window.')).toBeVisible();
    expect(connectionApp.requests.filter((request) => request.url().endsWith(CALLBACK_PATH))).toHaveLength(0);
    expect(connectionApp.connections).toHaveLength(0);
    if (sender !== popup) await sender.close();
    if (attack === 'wrong state') await popup.goto(providerURL);
    await allowConnection(popup);
    await expect(page.getByText('google-drive-1@example.test', { exact: true })).toBeVisible();
    expect(connectionApp.requests.filter((request) => request.url().endsWith(CALLBACK_PATH))).toHaveLength(1);
  });
}

test('duplicate callback messages confirm the connection only once', async ({ page, connectionApp }) => {
  await connectionApp.open();
  const popup = await startConnection(page, 'google-drive');
  const { code, state } = connectionApp.authorizations[0];

  await popup.goto(`${CLOUD_ORIGIN}/message-test`);
  await popup.evaluate(
    ({ query, targetOrigin }) => {
      const message = { type: 'appflowy:integration-oauth-callback', oauth_query: query };

      window.opener.postMessage(message, targetOrigin);
      window.opener.postMessage(message, targetOrigin);
    },
    { query: new URLSearchParams({ code, state }).toString(), targetOrigin: new URL(page.url()).origin }
  );
  await expect(page.getByText('google-drive-1@example.test', { exact: true })).toBeVisible();
  expect(connectionApp.requests.filter((request) => request.url().endsWith(CALLBACK_PATH))).toHaveLength(1);
  expect(connectionApp.connections).toHaveLength(1);
});

test('failed account loading disables Connect and Retry recovers', async ({ page, context, connectionApp }) => {
  let unavailable = true;
  let attempts = 0;

  await context.route('**/api/integrations/connections?**', (route) => {
    attempts++;
    return unavailable
      ? route.fulfill({
          status: 503,
          json: { code: 503, message: 'Connections temporarily unavailable' },
        })
      : route.fallback();
  });
  await connectionApp.open();
  await expect(page.getByRole('alert')).toContainText('Connections temporarily unavailable');
  expect(attempts).toBe(4); // Initial request plus the HTTP client's three bounded retries.
  await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toBeDisabled();
  unavailable = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await allowConnection(await startConnection(page, 'google-drive'));
  await expect(page.getByText('google-drive-1@example.test', { exact: true })).toBeVisible();
});

test('failed confirmation does not display a connected account and a fresh attempt recovers', async ({
  page,
  context,
  connectionApp,
}) => {
  await context.route(
    `**${CALLBACK_PATH}`,
    (route) =>
      route.fulfill({
        status: 503,
        json: { code: 503, message: 'Authorization service temporarily unavailable' },
      }),
    { times: 1 }
  );
  await connectionApp.open();
  await allowConnection(await startConnection(page, 'google-drive'));
  await expect(page.getByRole('alert')).toHaveText('Authorization service temporarily unavailable');
  expect(connectionApp.connections).toHaveLength(0);
  await expect(page.getByRole('table')).toBeHidden();

  await allowConnection(await startConnection(page, 'google-drive'));
  await expect(page.getByText('google-drive-1@example.test', { exact: true })).toBeVisible();
  expect(connectionApp.authorizations).toHaveLength(2);
  expect(connectionApp.connections).toHaveLength(1);
});

test('failed connection startup closes the blank popup and allows retry', async ({ page, context, connectionApp }) => {
  await context.route('**/api/integrations/connect/google-drive', (route) => route.abort('failed'), { times: 1 });
  await connectionApp.open();
  const opened = page.waitForEvent('popup');

  await page.getByTestId('connect-google-drive').click();
  const popup = await opened;

  await expect(page.getByRole('alert')).toContainText('Network Error');
  expect(popup.isClosed()).toBe(true);
  expect(connectionApp.authorizations).toHaveLength(0);
  await allowConnection(await startConnection(page, 'google-drive'));
  await expect(page.getByText('google-drive-1@example.test', { exact: true })).toBeVisible();
});

test('unconfigured providers stay disabled until capabilities are refreshed', async ({ page, connectionApp }) => {
  connectionApp.providers = ['google-drive'];
  await connectionApp.open();
  await expect(page.getByTestId('connect-google-drive')).toBeEnabled();
  await expect(page.getByTestId('connect-google-calendar')).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Unavailable connections: Google Calendar');
  connectionApp.providers.push('google-calendar');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await allowConnection(await startConnection(page, 'google-calendar'));
  await expect(page.getByText('google-calendar-1@example.test', { exact: true })).toBeVisible();
});

test('disconnect requires confirmation, preserves accounts on failure and removes only the selected account', async ({
  page,
  context,
  connectionApp,
}) => {
  await connectionApp.open();
  await allowConnection(await startConnection(page, 'google-drive'));
  await expect(page.getByText('google-drive-1@example.test', { exact: true })).toBeVisible();
  await allowConnection(await startConnection(page, 'google-calendar'));
  await expect(page.getByText('google-calendar-2@example.test', { exact: true })).toBeVisible();
  const [drive, calendar] = connectionApp.connections;
  const manage = page.getByRole('button', { name: `Manage connection for ${drive.account_identifier}`, exact: true });

  await manage.click();
  await page.getByRole('menuitem', { name: 'Disconnect account', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(connectionApp.requests.filter((request) => request.method() === 'DELETE')).toHaveLength(0);
  await manage.click();
  await page.getByRole('menuitem', { name: 'Disconnect account', exact: true }).click();
  await context.route(
    `**/api/integrations/connections/${drive.id}`,
    (route) =>
      route.fulfill({
        status: 503,
        json: { code: 503, message: 'Disconnect temporarily unavailable' },
      }),
    { times: 1 }
  );
  await page.getByTestId('confirm-disconnect-connection').click();
  await expect(page.getByText('Disconnect temporarily unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId(`connection-${drive.id}`)).toBeVisible();
  await expect(page.getByTestId(`connection-${calendar.id}`)).toBeVisible();

  await page.getByTestId('confirm-disconnect-connection').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId(`connection-${drive.id}`)).toBeHidden();
  await expect(page.getByTestId(`connection-${calendar.id}`)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(`connection-${calendar.id}`)).toContainText(calendar.account_identifier!);
  await expect(page.getByTestId(`connection-${drive.id}`)).toBeHidden();
  expect(connectionApp.connections.map((connection) => connection.id)).toEqual([calendar.id]);
});
