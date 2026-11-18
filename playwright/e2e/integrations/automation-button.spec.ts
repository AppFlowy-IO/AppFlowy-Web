import { expect } from '@playwright/test';

import { fixtureHTML, test } from '../../support/integrations-server';

test('run a real Button cell using the clicker’s account and replay an interrupted submission', async ({
  page,
  integrationsURL,
}) => {
  const api = '/api/workspace/team/database/tasks/row/second';
  const submitted: unknown[] = [];
  const reads: string[] = [];

  await page.route('**/__fixtures__/automation-button', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('automation-button') })
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()).pathname;

    if (url === api + '/button/review/run') {
      submitted.push(route.request().postDataJSON());
      if (submitted.length === 1) return route.abort('connectionreset');
      return route.fulfill({ json: { code: 0, data: 'accepted' } });
    }

    reads.push(url);
    if (url === api + '/button/review')
      return route.fulfill({
        json: {
          code: 0,
          data: {
            automation_id: 'scoped-rule',
            revision: 7,
            enabled: true,
            connectors: [{ action_index: 2, kind: 'gmail' }],
          },
        },
      });
    if (url === api + '/automation') return route.fulfill({ json: { code: 1004, message: 'read only' } });
    if (url === '/api/integrations/connections')
      return route.fulfill({
        json: {
          code: 0,
          data: {
            connections: [{ id: 'my-account', provider: 'gmail', status: 'active', account_identifier: 'My Gmail' }],
          },
        },
      });
    return route.fulfill({ status: 404, json: { code: -2, message: 'unexpected request' } });
  });
  await page.goto(new URL('/__fixtures__/automation-button', integrationsURL).href, { waitUntil: 'commit' });
  const cell = page.getByRole('button', { name: 'Request review' });

  await expect(cell).toHaveCount(2, { timeout: 60_000 });
  expect(reads).toEqual([]);
  await cell.nth(1).click();
  const dialog = page.getByRole('dialog', { name: 'Request review' });

  await expect(dialog.getByRole('button', { name: 'Run now' })).toBeDisabled();
  await dialog.getByLabel('Step 3 · gmail account').selectOption('my-account');
  await expect(dialog.getByRole('button', { name: 'Set up for this row' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Run now' }).click();
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Run queued.');
  expect(submitted).toHaveLength(2);
  expect(submitted[0]).toEqual({
    automation_id: 'scoped-rule',
    expected_revision: 7,
    request_id: expect.stringMatching(/^[\da-f-]{36}$/),
    connections: [{ action_index: 2, connection_id: 'my-account' }],
  });
  expect(submitted[1]).toEqual(submitted[0]);
  expect(reads.sort()).toEqual([api + '/button/review', api + '/automation', '/api/integrations/connections'].sort());
});

test('a guest configures a rule from the row header without database management or a Button field', async ({
  page,
  integrationsURL,
}) => {
  const routePath = '/api/workspace/team/database/tasks/row/second/automation';
  const calls: string[] = [];
  let body: Record<string, unknown> | undefined;

  await page.route('**/__fixtures__/automation-button?row-setup', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('automation-button') })
  );
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();

    calls.push(method + ' ' + pathname);
    if (pathname !== routePath) return route.fulfill({ json: { code: 1012, message: 'permission denied' } });
    if (method === 'POST') {
      body = route.request().postDataJSON();
      return route.fulfill({ json: { code: 0, data: { ...body, revision: 1 } } });
    }

    return route.fulfill({ json: { code: 0, data: { items: [] } } });
  });
  await page.goto(new URL('/__fixtures__/automation-button?row-setup', integrationsURL).href, { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Automations for this row' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Automations for this row' });

  await dialog.getByRole('button', { name: 'New automation' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Flag for follow-up');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => body?.name).toBe('Flag for follow-up');
  expect(body?.trigger).toEqual({ type: 'row_created' });
  expect(calls.filter((call) => call.includes('/automation')).every((call) => call.endsWith(routePath))).toBe(true);
  expect(calls.some((call) => call.includes('/button/'))).toBe(false);
  await expect(page.getByTestId('row-detail-duplicate')).toHaveCount(0);
});

test('review the authored Button message and open only a completed, authorized navigation result', async ({
  page,
  integrationsURL,
}) => {
  const endpoint = '/api/workspace/team/database/tasks/row/second/button/review';
  let submitted: { request_id: string; presentation_digest: string } | undefined;
  let resultReads = 0;

  await page.route('**/__fixtures__/automation-button?interactions', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('automation-button') })
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === endpoint)
      return route.fulfill({
        json: {
          code: 0,
          data: {
            automation_id: 'bound',
            revision: 9,
            enabled: true,
            connectors: [],
            confirmation: 'Send the review summary?',
            has_open_target: true,
            presentation_digest: 'reviewed',
          },
        },
      });
    if (path === endpoint + '/run') {
      submitted = route.request().postDataJSON();
      return route.fulfill({ json: { code: 0, data: submitted?.request_id } });
    }

    if (submitted && path === endpoint + '/run/' + submitted.request_id) {
      resultReads++;
      return route.fulfill({
        json: {
          code: 0,
          data:
            resultReads === 1
              ? { status: 'running', target: { type: 'url', url: 'https://example.org/early' } }
              : { status: 'succeeded', target: { type: 'url', url: 'https://example.org/review' } },
        },
      });
    }

    return route.fulfill({ json: { code: 1012, message: 'Denied' } });
  });
  await page.goto(new URL('/__fixtures__/automation-button?interactions', integrationsURL).href, {
    waitUntil: 'commit',
  });
  await page.getByRole('button', { name: 'Request review' }).nth(1).click({ timeout: 60_000 });
  await expect(page.getByText('Send the review summary?')).toBeVisible();
  expect(submitted).toBeUndefined();
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect(page.getByRole('link', { name: 'Open link' })).toHaveAttribute('href', 'https://example.org/review');
  expect(submitted?.presentation_digest).toBe('reviewed');
  expect(resultReads).toBe(2);
});

test('two rapid activations of a plain Button submit once and reopening the cell creates a new click', async ({
  page,
  integrationsURL,
}) => {
  const submitted: string[] = [];

  await page.route('**/__fixtures__/automation-button?interactions', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('automation-button') })
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.endsWith('/button/review/run')) {
      const key = route.request().postDataJSON().request_id as string;

      submitted.push(key);
      await route.fulfill({ json: { code: 0, data: key } });
    } else if (url.pathname.endsWith('/button/review')) {
      await route.fulfill({
        json: { code: 0, data: { automation_id: 'direct-rule', revision: 1, enabled: true, connectors: [] } },
      });
    } else if (url.pathname.endsWith('/automation')) await route.fulfill({ json: { code: 0, data: { items: [] } } });
    else await route.abort();
  });
  await page.goto(new URL('/__fixtures__/automation-button?interactions', integrationsURL).href, {
    waitUntil: 'commit',
  });
  const cell = page.getByRole('button', { name: 'Request review', exact: true }).nth(1);

  await expect(cell).toBeVisible({ timeout: 60_000 });
  expect(submitted).toHaveLength(0);
  await cell.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Run queued.');
  expect(submitted).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await cell.click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Run queued.');
  expect(submitted).toHaveLength(2);
  expect(submitted[0]).not.toBe(submitted[1]);
});
