import { expect, type Page } from '@playwright/test';
import * as Y from 'yjs';

import { fixtureHTML, test } from '../../support/integrations-server';

const WORKSPACE = '00000000-0000-4000-8000-000000000010';
const DATABASE = '00000000-0000-4000-8000-000000000011';
const CONTAINER = '00000000-0000-4000-8000-000000000012';
const DASHBOARD = '00000000-0000-4000-8000-000000000013';
const SOURCE = '00000000-0000-4000-8000-000000000014';
const RESTORE = '00000000-0000-0000-0000-000000000000';
const PATH = '/v2/page-view/database-view/default';
const fixturePath = `/app/${WORKSPACE}/${DASHBOARD}`;

type Command = { request_id: string; view: { view_id: string; source_view_id: string; name: string;
  responses_view_id: string | null }; extra: { dashboard_owner: string } };
type Folder = { view_id: string; parent_view_id?: string; name?: string; layout?: number; extra: Record<string, unknown> };

async function duplicate(page: Page) {
  await page.getByTestId('clone-fixture-widget').first().getByRole('button', { name: 'Widget options Source', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
}

for (const layout of [0, 7]) {
  test(`owned layout ${layout} recovers one copy after a refused request and a lost committed response`, async ({ page, integrationsURL }, info) => {
    const remote = new Y.Doc();
    const database = new Y.Map();
    const views = new Y.Map<Y.Map<unknown>>();
    const source = new Y.Map<unknown>();
    const dashboard = new Y.Map<unknown>();
    const configuration = { filters: [{ id: 'filter', field_id: 'name', condition: 0, content: 'alpha' }],
      sorts: [{ id: 'sort', field_id: 'name', condition: 1 }], groups: [{ id: 'group', field_id: 'status', groups: [{ id: 'ready' }] }],
      field_settings: { name: { width: 281, visibility: 0 } }, calculations: [{ id: 'footer', calculation_type: 9 }],
      form_field_settings: { name: { required: true } }, layout_settings: { [layout]: { number_format: 'percent', calculation: 'percent_checked' } } };

    database.set('id', DATABASE); database.set('views', views); database.set('fields', new Y.Map());
    remote.getMap('data').set('database', database);
    Object.entries({ id: SOURCE, database_id: DATABASE, layout, name: 'Source', ...configuration }).forEach(([key, value]) => source.set(key, value));
    source.set('field_orders', Y.Array.from([{ id: 'name' }]));
    source.set('row_orders', Y.Array.from([{ id: 'row', height: 60 }]));
    views.set(SOURCE, source);
    dashboard.set('id', DASHBOARD); dashboard.set('layout', 9);
    dashboard.set('layout_settings', new Y.Map([['9', new Y.Map([['rows', [{ id: 'row-1', height: 360, widgets: [
      { id: 'original-widget', view_id: SOURCE, database_id: DATABASE, width: 12 },
    ] }]]])]]));
    views.set(DASHBOARD, dashboard);
    const folder = new Map<string, Folder>([
      [SOURCE, { view_id: SOURCE, parent_view_id: CONTAINER, name: 'Source', layout: layout === 7 ? 9 : 1, extra: { database_id: DATABASE } }],
      [CONTAINER, { view_id: CONTAINER, name: 'Database', extra: { database_id: DATABASE, is_database_container: true } }],
    ]);
    const commands: string[] = [];
    const legacy: string[] = [];
    const receipts = new Map<string, unknown>();
    let refused = false;
    let lost = false;
    let createdId = '';
    let firstCommittedOwner: unknown;
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/qa-owned-clone-state', (route) => route.fulfill({ json: Array.from(Y.encodeStateAsUpdate(remote)) }));
    await page.route('**/qa-owned-clone-sync', async (route) => {
      Y.applyUpdate(remote, Uint8Array.from(route.request().postDataJSON()));
      await route.fulfill({ status: 204 });
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const reply = (data: unknown, code = 0) => route.fulfill({ json: { code, data, message: code ? 'atomic creation is busy; retry the same request' : 'OK' } });

      if (path.endsWith('/restore-state')) return reply({ database_restore_id: null, version: null });
      if (path.includes('/collab/')) return reply({ object_id: DATABASE, doc_state: Array.from(Y.encodeStateAsUpdate(remote)),
        state_vector: Array.from(Y.encodeStateVector(remote)), version: 0, collab_version: null });
      if (request.method() === 'GET' && path.endsWith('/views')) {
        const ids = new URL(request.url()).searchParams.get('view_ids')?.split(',') ?? [];

        return reply(ids.map((id) => folder.get(id)).filter(Boolean));
      }

      if (request.method() === 'GET' && path.includes('/view/')) return reply(folder.get(path.split('/').pop()!));
      if (request.method() === 'POST' && /\/page-view\/[^/]+\/database-view$/.test(path)) {
        legacy.push(path);
        // The real legacy failure leaves a committed view while returning1017. Never replay it.
        const payload = request.postDataJSON();
        const orphan = source.clone() as Y.Map<unknown>;

        orphan.set('id', 'legacy-unowned-copy'); orphan.set('name', payload.name);
        views.set('legacy-unowned-copy', orphan);
        folder.set('legacy-unowned-copy', { view_id: 'legacy-unowned-copy', parent_view_id: CONTAINER,
          name: payload.name, extra: { database_id: DATABASE } });
        return reply(undefined, 1017);
      }

      if (path.endsWith(PATH)) {
        commands.push(request.postData()!);
        const command = request.postDataJSON() as Command;

        if (!refused) { refused = true; return reply(undefined, -5); }

        let receipt = receipts.get(command.request_id);

        if (!receipt) {
          const copy = source.clone() as Y.Map<unknown>;

          copy.set('id', command.view.view_id); copy.set('name', command.view.name);
          views.set(command.view.view_id, copy);
          folder.set(command.view.view_id, { view_id: command.view.view_id, parent_view_id: CONTAINER,
            layout: layout === 7 ? 9 : 1, extra: { database_id: DATABASE, ...command.extra } });
          if (command.view.responses_view_id) {
            const responses = new Y.Map<unknown>();

            responses.set('id', command.view.responses_view_id); responses.set('database_id', DATABASE); responses.set('layout', 0);
            views.set(command.view.responses_view_id, responses);
            folder.set(command.view.responses_view_id, { view_id: command.view.responses_view_id, parent_view_id: CONTAINER,
              layout: 1, extra: { database_id: DATABASE } });
          }

          receipt = { request_id: command.request_id, outcome: 'applied', result: {
            view_id: command.view.view_id, view_ids: [command.view.view_id, ...(command.view.responses_view_id ? [command.view.responses_view_id] : [])],
            database_id: DATABASE, database_restore_id: RESTORE, database_version: null,
            database_update_v1: 'AQ==', update_batch_id: '00000000-0000-4000-8000-000000000099',
          } };
          receipts.set(command.request_id, receipt);
        }

        if (!lost) {
          createdId = command.view.view_id;
          firstCommittedOwner = folder.get(createdId)?.extra.dashboard_owner;
          // A later edit is current authority; receipt recovery must not overwrite it from the source.
          views.get(createdId)!.set('filters', [{ id: 'later-filter', content: 'later edit' }]);
          lost = true;
          return route.abort('failed');
        }

        return reply(receipt);
      }

      throw new Error('Unexpected fixture request: ' + request.method() + ' ' + path);
    });
    await page.route(`**${fixturePath}`, (route) => route.fulfill({ contentType: 'text/html', body: fixtureHTML('dashboard-owned-clone') }));
    try {
      await page.goto(new URL(fixturePath, integrationsURL).href);
      await expect(page.getByTestId('clone-fixture-widget')).toHaveCount(1, { timeout: 60_000 });
      await duplicate(page);
      await expect.poll(() => commands.length + legacy.length).toBeGreaterThan(0);
      await expect.poll(() => lost || legacy.length > 0).toBe(true);
      expect(firstCommittedOwner, 'The initial committed view must already belong to its dashboard').toBe(DASHBOARD);
      expect(receipts.size, 'One durable creation graph must survive the lost reply').toBe(1);
      expect(legacy).toEqual([]);
      await expect(page.getByText('Creation is pending. Retry the original request to finish.', { exact: true })).toBeVisible();
      expect(commands).toHaveLength(2);
      await expect(page.getByTestId('clone-fixture-widget')).toHaveCount(1);
      await page.getByRole('button', { name: 'Receive remote changes', exact: true }).click();
      await duplicate(page);
      await expect(page.getByTestId('clone-fixture-widget')).toHaveCount(2);
      expect(new Set(commands).size).toBe(1);
      expect(receipts.size).toBe(1);
      const copied = page.locator(`[data-testid="clone-fixture-widget"][data-view-id="${createdId}"]`);

      await expect(copied.getByRole('button')).toHaveText('Source (1)');
      const actual = JSON.parse(await copied.getByTestId('clone-fixture-configuration').innerText());

      expect(actual.dashboard_owner).toBe(DASHBOARD);
      expect(actual.filters).toEqual([{ id: 'later-filter', content: 'later edit' }]);
      Object.entries(configuration).filter(([key]) => key !== 'filters').forEach(([key, value]) => expect(actual[key]).toEqual(value));
      for (const count of [3, 4]) {
        await duplicate(page);
        await expect(page.getByTestId('clone-fixture-widget')).toHaveCount(count);
      }

      expect(receipts.size).toBe(3);
      expect(new Set(await page.getByTestId('clone-fixture-widget').evaluateAll((widgets) => widgets.map((widget) => widget.getAttribute('data-view-id')))).size).toBe(4);
      await page.reload();
      await expect(page.getByTestId('clone-fixture-widget')).toHaveCount(4);
      expect(legacy).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach('atomic-widget-copy-commands', { contentType: 'application/json', body: JSON.stringify({
        layout, posts: commands.length, uniqueCommands: new Set(commands).size, committedGraphs: receipts.size, firstCommittedOwner,
      }) });
    } finally {
      await info.attach('committed-widget-copy-state', { contentType: 'application/json', body: JSON.stringify({
        layout, posts: commands.length, uniqueCommands: new Set(commands).size, committedGraphs: receipts.size,
        firstCommittedOwner, legacyRequests: legacy.length, legacyOrphan: folder.get('legacy-unowned-copy'),
      }) });
      remote.destroy();
    }
  });
}
