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
  const connect = dialog.getByRole('button', { name: 'Connect Gmail' });

  await expect(connect).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Connect Slack' })).toHaveCount(0);
  await dialog.getByLabel('Step 3 · gmail account').selectOption('my-account');
  await expect(dialog.getByRole('button', { name: 'Set up for this row' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Run now' }).click();
  await expect(connect).toBeDisabled();
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
  let readsAfterCreate = 0;

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

    const items = body
      ? [{ ...body, revision: 1, enabled: true, status: ++readsAfterCreate === 1 ? 'setting_up' : 'active' }]
      : [];

    return route.fulfill({ json: { code: 0, data: { items } } });
  });
  await page.goto(new URL('/__fixtures__/automation-button?row-setup', integrationsURL).href, { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Automations for this row' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'Automations for this row' });

  await dialog.getByRole('button', { name: 'New automation' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Flag for follow-up');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => body?.name).toBe('Flag for follow-up');
  expect(body?.trigger).toEqual({ type: 'row_created' });
  await expect(dialog.getByText('Setting up', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Check setup status' }).click();
  await expect(dialog.getByText('Active', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Check setup status' })).toHaveCount(0);
  expect(readsAfterCreate).toBe(2);
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

test('a workflow editor saves a destination step and an explicitly bound calendar from the browser', async ({
  page,
  integrationsURL,
}) => {
  const base = '/api/workspace/team/database';
  const rules = base + '/tasks/automation';
  const row = 'd2ba21ea-2604-4acf-8feb-5dc766b3b512';
  const stored = {
    id: 'workflow',
    revision: 3,
    name: 'Update the new row',
    enabled: true,
    status: 'active',
    timezone: 'UTC',
    conditions: [],
    trigger: { type: 'row_created' },
    actions: [
      { type: 'create_row', database_id: 'dest', view_id: 'v', properties: [] },
      {
        type: 'edit_row',
        database_id: 'tasks',
        row: { type: 'trigger' },
        properties: [{ field_id: 'title', value: { kind: 'text', value: 'Initial title' } }],
      },
    ],
  };
  const scheduled = {
    ...stored,
    id: 'calendar',
    name: 'Weekly update',
    trigger: { type: 'scheduled' },
    requires_source_row: true,
  };
  const calendar = {
    revision: 3,
    starts_on: '2026-11-18',
    local_time: '09:00:00',
    frequency: 'weekly',
    timezone: 'UTC',
    next_due_at: null,
  };
  let submittedRule: Record<string, unknown> | undefined;
  let submittedSchedule: Record<string, unknown> | undefined;

  await page.route('**/__fixtures__/automation-button?workflow', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('automation-button') })
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const respond = (data: unknown) => route.fulfill({ json: { code: 0, data } });

    if (method === 'PATCH' && path === rules + '/workflow') {
      submittedRule = route.request().postDataJSON();
      return respond(stored);
    }

    if (method === 'PUT' && path === rules + '/calendar/schedule') {
      submittedSchedule = route.request().postDataJSON();
      return respond(calendar);
    }

    if (path === rules) return respond({ items: [stored, scheduled] });
    if (path === rules + '/workflow') return respond(stored);
    if (path === rules + '/calendar') return respond(scheduled);
    if (path === rules + '/calendar/schedule') return respond(calendar);
    if (path.endsWith('/fields')) return respond([{ id: 'title', name: 'Title', field_type_id: 0 }]);
    if (path === base)
      return respond({
        databases: ['tasks', 'dest', 'other'].map((database_id) => ({
          database_id,
          views: [{ view_id: 'v', name: database_id }],
        })),
        has_more: false,
      });
    return route.fulfill({ status: 404 });
  });
  await page.goto(new URL('/__fixtures__/automation-button?workflow', integrationsURL).href, { waitUntil: 'commit' });
  await page.getByRole('button', { name: stored.name }).click({ timeout: 60_000 });
  const destination = page.getByLabel('Target database').last();
  const target = page.getByLabel('Target row');

  await expect(target).toHaveValue('trigger');
  await destination.selectOption('other');
  await expect(target).toHaveValue('id');
  await expect(target.getByRole('option', { name: 'Triggering row' })).toHaveCount(0);
  await destination.selectOption('dest');
  await expect(target).toHaveValue('step');
  await expect(page.getByLabel('Row from action')).toHaveValue('0');
  await page.getByRole('button', { name: 'Add a property' }).last().click();
  await page.getByLabel('Property', { exact: true }).selectOption('title');
  await page.getByLabel('Value', { exact: true }).fill('Updated title');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() => submittedRule)
    .toEqual({
      expected_revision: 3,
      actions: [
        stored.actions[0],
        {
          type: 'edit_row',
          database_id: 'dest',
          row: { type: 'step', action_index: 0 },
          properties: [{ field_id: 'title', value: { kind: 'text', value: 'Updated title' } }],
        },
      ],
    });

  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByLabel('Row ID', { exact: true }).fill(row);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => submittedSchedule?.row_id).toBe(row);
});

test('a select variable is authored from destination property options and preserved through its consumers', async ({
  page,
  integrationsURL,
}) => {
  const base = '/api/workspace/team/database';
  const endpoint = base + '/tasks/automation';
  const definition = { type: 'define_variable', name: 'stage', value: { kind: 'text', value: '' } };
  const actions = [
    definition,
    {
      type: 'create_row',
      database_id: 'dest',
      view_id: 'v',
      properties: [{ field_id: 'stage', value: { kind: 'variable', name: 'stage' } }],
    },
  ];
  const stored = {
    id: 'copy',
    revision: 2,
    enabled: true,
    name: 'Plan a task',
    timezone: 'UTC',
    trigger: { type: 'scheduled' },
    conditions: [],
    actions,
    status: 'active',
  };
  const catalog = ['stage', 'other'].map((id) => ({
    id,
    name: id,
    field_type_id: 3,
    type_option: { content: { options: [{ id: id + '-ready', name: 'Ready' }] } },
  }));
  let posted: Record<string, unknown> | undefined;

  await page.route('**/__fixtures__/automation-button?workflow', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('automation-button') })
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const respond = (data: unknown) => route.fulfill({ json: { code: 0, data } });

    if (path === endpoint + '/copy' && route.request().method() === 'PATCH') {
      posted = route.request().postDataJSON();
      return respond(stored);
    }

    if (path === endpoint) return respond({ items: [stored] });
    if (path === endpoint + '/copy') return respond(stored);
    if (path === endpoint + '/copy/schedule') return route.fulfill({ json: { code: -2, message: 'Missing schedule' } });
    if (path === base + '/dest/fields') return respond(catalog);
    if (path === base)
      return respond({
        databases: [{ database_id: 'dest', views: [{ view_id: 'v', name: 'Archive' }] }],
        has_more: false,
      });
    return route.fulfill({ status: 404 });
  });
  await page.goto(new URL('/__fixtures__/automation-button?workflow', integrationsURL).href, { waitUntil: 'commit' });
  await page.getByRole('button', { name: stored.name }).click({ timeout: 60_000 });
  const variable = page.getByRole('group', { name: 'Action 1', exact: true });

  await variable.getByLabel('Value source').selectOption('single_select');
  await variable.getByLabel('Target database').selectOption('dest');
  await variable.getByLabel('Property', { exact: true }).selectOption('other');
  await variable.getByLabel('Option', { exact: true }).selectOption('other-ready');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Choose options that belong to the property');
  expect(posted).toBeUndefined();
  await variable.getByLabel('Property', { exact: true }).selectOption('stage');
  await expect(variable.getByLabel('Value', { exact: true })).toHaveText('other-ready');
  await variable.getByLabel('Option', { exact: true }).selectOption('stage-ready');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() => posted)
    .toEqual({
      expected_revision: 2,
      actions: [{ ...definition, value: { kind: 'single_select', value: 'stage-ready' } }, actions[1]],
    });
});

test('a notification editor saves a workspace group and inline formula through the rule API', async ({
  page,
  integrationsURL,
}) => {
  const collection = '/api/workspace/team/database/tasks/automation';
  const group = '825119c1-c9e1-4bcd-b54c-b31ba43ee9de';
  const rule = {
    id: 'rich',
    name: 'Notify reviewers',
    enabled: true,
    status: 'active',
    revision: 4,
    timezone: 'UTC',
    trigger: { type: 'row_created' },
    conditions: [],
    actions: [{ type: 'notify', notify_actor: true, message_template: { parts: [{ type: 'text', value: 'Review' }] } }],
  };
  let saved: Record<string, unknown> | undefined;

  await page.route('**/__fixtures__/automation-button?workflow', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHTML('automation-button') })
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) => route.fulfill({ json: { code: 0, data } });

    if (path === collection) return ok({ items: [rule] });
    if (path === collection + '/rich') {
      if (route.request().method() === 'PATCH') saved = route.request().postDataJSON();
      return ok(rule);
    }

    if (path === '/api/workspace/team/groups') return ok({ groups: [{ group_id: group, name: 'Design reviewers' }] });
    if (path.endsWith('/fields')) return ok([{ id: 'projects', name: 'Projects', field_type_id: 10 }]);
    if (path.endsWith('/database')) return ok({ databases: [], has_more: false });
    return route.fulfill({ status: 404 });
  });
  await page.goto(new URL('/__fixtures__/automation-button?workflow', integrationsURL).href, { waitUntil: 'commit' });
  await page.getByRole('button', { name: rule.name }).click({ timeout: 60_000 });
  const template = page.getByRole('group', { name: 'Notification message', exact: true });

  await template.getByLabel('Value source').selectOption('group');
  await template.getByLabel('Value', { exact: true }).selectOption({ label: 'Design reviewers' });
  await template.getByRole('button', { name: 'Add a part', exact: true }).click();
  await template.getByLabel('Value source').nth(1).selectOption('expression');
  await template.getByLabel('Formula expression').fill('prop("projects").length()');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() => saved)
    .toEqual({
      expected_revision: 4,
      actions: [
        {
          type: 'notify',
          notify_actor: true,
          message_template: {
            parts: [
              { type: 'group', group_id: group },
              { type: 'expression', expression: 'prop("projects").length()' },
            ],
          },
        },
      ],
    });
});

for (const allowed of [true, false]) {
  test(`opening a failed row-scoped rule from the inbox rechecks access (${allowed ? 'editor' : 'revoked'})`, async ({page, integrationsURL}) => {
    const database = 'bcbbf78c-9f95-45a8-b79d-1573a789da37';
    const id = 'bbdd71d4-01db-44d4-adb4-862f8ef55962';
    const row = 'bec03fe2-a539-43cf-b70b-44167e356507';
    const calls: string[] = [];
    const path = '/api/workspace/team/database/' + database + '/row/' + row + '/automation/' + id;

    await page.route('**/__fixtures__/automation-button?recover*', route => route.fulfill({
      contentType: 'text/html', body: fixtureHTML('automation-button'),
    }));
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;

      if (pathname === path && route.request().method() === 'GET') {
        calls.push(pathname);
        return route.fulfill({ json: allowed ? { code: 0, data: {
          id, revision: 4, name: 'Fix assignment', enabled: false, status: 'disabled', timezone: 'Etc/UTC',
          trigger: { type: 'row_created' }, actions: [{ type: 'notify', notify_actor: true }], conditions: [],
        } } : { code: 1012, message: 'access revoked' } });
      }

      return route.fulfill({json:{code:0,data:{items:[]}}});
    });
    const url = new URL('/__fixtures__/automation-button', integrationsURL);

    url.search = new URLSearchParams({recover: '1', automationDatabase: database, automationId: id, automationRow: row}).toString();
    await page.goto(url.href, { waitUntil:'commit' });
    const dialog = page.getByRole('dialog');

    if (allowed) {
      await expect(dialog.getByLabel('Name', {exact:true})).toHaveValue('Fix assignment');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(new URL(page.url()).searchParams.has('automationId')).toBe(false);
      expect(new URL(page.url()).searchParams.has('recover')).toBe(true);
    } else {
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByLabel('Name', {exact:true})).toHaveCount(0);
    }

    expect(calls).toEqual([path]);
  });
}
