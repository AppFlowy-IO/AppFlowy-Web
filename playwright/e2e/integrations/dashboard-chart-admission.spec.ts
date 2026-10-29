import { expect, type Page } from '@playwright/test';
import * as Y from 'yjs';

import { ERROR_CODE } from '../../../src/application/constants';
import { isChartViewCreationRequest, refuseChartViewCreation } from '../../support/dashboard-add-widget-helpers';
import { fixtureHTML, test } from '../../support/integrations-server';

const WORKSPACE = '00000000-0000-4000-8000-000000000010';
const DATABASE = '00000000-0000-4000-8000-000000000011';
const CONTAINER = '00000000-0000-4000-8000-000000000012';
const DASHBOARD = '00000000-0000-4000-8000-000000000013';
const SOURCE = '00000000-0000-4000-8000-000000000014';
const PATH = '/v2/page-view/database-view/default';
const fixturePath = `/app/${WORKSPACE}/${DASHBOARD}`;

type Command = { request_id: string; view: { view_id: string; name: string; layout: number }; extra: { dashboard_owner: string } };
type Folder = { view_id: string; parent_view_id?: string; name: string; layout?: number; extra: Record<string, unknown> };

/** Real hook/journal/HTTP entry points; only the isolated Server boundary is simulated. */
async function admissionServer(page: Page, mode: 'normal' | 'lost' | 'hydration' = 'normal') {
  const remote = new Y.Doc();
  const database = new Y.Map();
  const views = new Y.Map<Y.Map<unknown>>();
  const dashboard = new Y.Map<unknown>();
  const source = new Y.Map<unknown>();

  remote.getMap('data').set('database', database);
  database.set('id', DATABASE); database.set('views', views); database.set('fields', new Y.Map());
  source.set('id', SOURCE); source.set('database_id', DATABASE); source.set('layout', 0); source.set('name', 'Source');
  views.set(SOURCE, source);
  dashboard.set('id', DASHBOARD); dashboard.set('layout', 9);
  dashboard.set('layout_settings', new Y.Map([['9', new Y.Map([['rows', [{ id: 'original-row', height: 360, widgets: [
    { id: 'original-widget', view_id: SOURCE, database_id: DATABASE, width: 12 },
  ] }]]])]]));
  views.set(DASHBOARD, dashboard);
  const folder = new Map<string, Folder>([
    [SOURCE, { view_id: SOURCE, parent_view_id: CONTAINER, name: 'Source', extra: { database_id: DATABASE } }],
    [DASHBOARD, { view_id: DASHBOARD, parent_view_id: CONTAINER, name: 'Dashboard', extra: { database_id: DATABASE } }],
    [CONTAINER, { view_id: CONTAINER, name: 'Database', extra: { database_id: DATABASE, is_database_container: true } }],
  ]);
  const commands: string[] = [];
  const receipts = new Map<string, unknown>();
  const legacy: string[] = [];
  const errors: string[] = [];
  const diagnostics: string[] = [];
  let withheld = false;
  let refuseHydration = mode === 'hydration';

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) diagnostics.push(message.text());
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(PATH)) commands.push(request.postData()!);
  });
  await page.route('**/qa-owned-clone-state', (route) => route.fulfill({ json: Array.from(Y.encodeStateAsUpdate(remote)) }));
  await page.route('**/qa-owned-clone-sync', async (route) => {
    Y.applyUpdate(remote, Uint8Array.from(route.request().postDataJSON()));
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (data: unknown) => route.fulfill({ json: { code: 0, data, message: 'OK' } });

    if (path.endsWith('/restore-state')) return reply({ database_restore_id: null, version: null });
    if (path.includes('/collab/')) return reply({ object_id: DATABASE, doc_state: Array.from(Y.encodeStateAsUpdate(remote)),
      state_vector: Array.from(Y.encodeStateVector(remote)), version: 0, collab_version: null });
    if (request.method() === 'GET' && path.endsWith('/views')) {
      const ids = new URL(request.url()).searchParams.get('view_ids')?.split(',') ?? [];

      return reply(ids.map((id) => folder.get(id)).filter(Boolean));
    }

    if (request.method() === 'GET' && path.includes('/view/')) {
      const id = path.split('/').pop()!;

      if (refuseHydration && id !== SOURCE && id !== DASHBOARD && id !== CONTAINER) {
        return route.fulfill({ status: 400, json: { code: ERROR_CODE.INVALID_SUBSCRIPTION_PLAN, message: 'Pro required' } });
      }

      return reply(folder.get(id));
    }

    if (request.method() === 'POST' && /\/page-view\/[^/]+\/database-view$/.test(path)) {
      legacy.push(path);
      throw new Error('Admission must use the atomic creation path');
    }

    if (path.endsWith(PATH)) {
      const command = request.postDataJSON() as Command;
      let receipt = receipts.get(command.request_id);

      if (!receipt) {
        const view = new Y.Map<unknown>();

        Object.entries({ id: command.view.view_id, database_id: DATABASE, layout: command.view.layout,
          name: command.view.name }).forEach(([key, value]) => view.set(key, value));
        view.set('field_orders', new Y.Array()); view.set('row_orders', new Y.Array()); view.set('layout_settings', new Y.Map());
        views.set(command.view.view_id, view);
        folder.set(command.view.view_id, { view_id: command.view.view_id, parent_view_id: CONTAINER,
          name: command.view.name, layout: command.view.layout === 3 ? 5 : 1,
          extra: { database_id: DATABASE, ...command.extra } });
        receipt = { request_id: command.request_id, outcome: 'applied', result: {
          view_id: command.view.view_id, view_ids: [command.view.view_id], database_id: DATABASE,
          database_restore_id: '00000000-0000-0000-0000-000000000000', database_version: null,
          database_update_v1: 'AQ==', update_batch_id: '00000000-0000-4000-8000-000000000099',
        } };
        receipts.set(command.request_id, receipt);
      }

      if (mode === 'lost' && !withheld) { withheld = true; return route.abort('failed'); }

      return reply(receipt);
    }

    throw new Error('Unexpected admission request: ' + request.method() + ' ' + path);
  });
  await page.route(`**${fixturePath}`, (route) => route.fulfill({ contentType: 'text/html', body: fixtureHTML('dashboard-owned-clone') }));
  return { remote, commands, receipts, folder, legacy, errors, diagnostics, allowHydration: () => { refuseHydration = false; } };
}

const widgets = (page: Page) => page.getByTestId('clone-fixture-widget');
const configuration = async (page: Page) => JSON.parse(await widgets(page).last().getByTestId('clone-fixture-configuration').innerText());

for (const choice of ['default', 'refused', 'admitted'] as const) {
  test(`an atomic plan refusal preserves a Table for the ${choice} Chart choice`, async ({ page, integrationsURL }, info) => {
    const server = await admissionServer(page);
    const stopRefusing = await refuseChartViewCreation(page);

    try {
      await page.goto(new URL(fixturePath, integrationsURL).href);
      await expect(widgets(page)).toHaveCount(1, { timeout: 60_000 });
      await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
      await page.getByRole('button', { name: 'Add widget', exact: true }).click();
      await expect(widgets(page)).toHaveCount(2);
      await expect.poll(() => configuration(page)).toMatchObject({ name: 'Table', layout: 0, dashboard_owner: DASHBOARD });
      const tableId = await widgets(page).last().getAttribute('data-view-id');

      if (choice !== 'default') {
        if (choice === 'admitted') await stopRefusing();
        const response = page.waitForResponse((value) => isChartViewCreationRequest(value.request()));

        await page.getByRole('button', { name: 'Choose Chart', exact: true }).click();
        await response;
        await expect.poll(() => configuration(page)).toMatchObject({
          name: choice === 'admitted' ? 'Chart' : 'Table', layout: choice === 'admitted' ? 3 : 0, dashboard_owner: DASHBOARD,
        });
        if (choice === 'refused') await expect(widgets(page).last()).toHaveAttribute('data-view-id', tableId!);
        else await expect(widgets(page).last()).not.toHaveAttribute('data-view-id', tableId!);
      }

      const id = await widgets(page).last().getAttribute('data-view-id');

      await page.getByRole('button', { name: 'Dismiss picker', exact: true }).click();
      await page.reload();
      await expect(widgets(page)).toHaveCount(2);
      await expect(widgets(page).last()).toHaveAttribute('data-view-id', id!);
      expect(await configuration(page)).toMatchObject({ name: choice === 'admitted' ? 'Chart' : 'Table',
        layout: choice === 'admitted' ? 3 : 0, dashboard_owner: DASHBOARD });
      expect(server.commands.map((command) => (JSON.parse(command) as Command).view.layout)).toEqual(choice === 'default' ? [3, 0] : [3, 0, 3]);
      expect(server.receipts.size).toBe(choice === 'admitted' ? 2 : 1);
      expect(server.legacy).toEqual([]); expect(server.errors).toEqual([]);
    } finally {
      await info.attach('chart-admission-boundary', { contentType: 'application/json', body: JSON.stringify({
        commands: server.commands, committedGraphs: server.receipts.size, diagnostics: server.diagnostics, errors: server.errors,
      }) });
      server.remote.destroy();
    }
  });
}

for (const mode of ['lost', 'hydration'] as const) {
  test(`a ${mode} Chart creation stays recoverable without a fallback Table`, async ({ page, integrationsURL }) => {
    const server = await admissionServer(page, mode);

    try {
      await page.goto(new URL(fixturePath, integrationsURL).href);
      await expect(widgets(page)).toHaveCount(1, { timeout: 60_000 });
      await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
      await page.getByRole('button', { name: 'Add widget', exact: true }).click();
      await expect(page.getByText(mode === 'lost' ? 'Creation is pending. Retry the original request to finish.' :
        'Created, but it could not be opened. Retry to open it.', { exact: true })).toBeVisible();
      await expect(widgets(page)).toHaveCount(1);
      expect(server.receipts.size).toBe(1);
      expect(server.commands).toHaveLength(1);
      server.allowHydration();
      await page.getByRole('button', { name: 'Add widget', exact: true }).click();
      await expect(widgets(page)).toHaveCount(2);
      expect(await configuration(page)).toMatchObject({ name: 'Chart', layout: 3, dashboard_owner: DASHBOARD });
      expect(new Set(server.commands).size).toBe(1);
      expect(server.commands).toHaveLength(mode === 'lost' ? 2 : 1);
      expect(server.receipts.size).toBe(1);
      await page.reload();
      await expect(widgets(page)).toHaveCount(2);
      expect(server.legacy).toEqual([]); expect(server.errors).toEqual([]);
    } finally { server.remote.destroy(); }
  });
}
