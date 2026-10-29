/** @jest-environment node */
import * as Y from 'yjs';

import { createDatabaseViewThroughApi, registerDashboardWorld } from './dashboard-test-helpers';

import type { CreateDefaultDatabaseViewRequest } from '../../src/application/atomic-creation/types';
import type { APIRequestContext, Page } from '@playwright/test';

jest.mock('@playwright/test', () => ({
  expect: { poll: (read: () => Promise<unknown>) => ({ toBe: async (value: unknown) => expect(await read()).toBe(value) }) },
}));

it('creates an owned Calendar with both owner markers committed before a browser reload', async () => {
  const server = new Y.Doc();
  const browser = new Y.Doc();
  const reopened = new Y.Doc();
  const previousWindow = globalThis.window;
  const database = new Y.Map<unknown>([['id', 'database'], ['views', new Y.Map()]]);
  const commands: CreateDefaultDatabaseViewRequest[] = [];
  let folderExtra: Record<string, unknown> | null | undefined;

  server.getMap('data').set('database', database);
  Y.applyUpdate(browser, Y.encodeStateAsUpdate(server));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    Y, __DASHBOARD_TEST__: { byDatabase: () => ({ databaseDoc: browser }) },
  } });
  const page = { evaluate: async (read: (argument: unknown) => unknown, argument: unknown) => read(argument) } as unknown as Page;
  const request = {
    get: jest.fn().mockResolvedValue({ ok: () => true, status: () => 200,
      text: async () => JSON.stringify({ code: 0, data: { database_restore_id: null } }) }),
    post: jest.fn().mockImplementation(async (_url, options: { data: string }) => {
      const command = JSON.parse(options.data) as CreateDefaultDatabaseViewRequest;
      const view = new Y.Map<unknown>([['name', command.view.name], ['layout', command.view.layout]]);

      commands.push(command);
      folderExtra = command.extra;
      if (command.extra?.dashboard_owner) view.set('dashboard_owner', command.extra.dashboard_owner);
      (database.get('views') as Y.Map<unknown>).set(command.view.view_id, view);
      return { ok: () => true, json: async () => ({ code: 0, data: {
        request_id: command.request_id, outcome: 'applied', result: {
          view_id: command.view.view_id, database_id: 'database',
          database_update_v1: Buffer.from(Y.encodeStateAsUpdate(server)).toString('base64'),
        },
      } }) };
    }),
  } as unknown as APIRequestContext;

  registerDashboardWorld(page, {
    runId: 'fixture', owner: { accessToken: 'test-owned-token', refreshToken: '', tokenData: {} },
    workspaceId: 'workspace', spaceId: 'space', spaceName: 'Space', widgets: {}, databases: {
      Host: { name: 'Host', spaceId: 'space', pageId: 'container', databaseId: 'database',
        fieldIds: {}, rowIds: {}, views: {} },
    },
  });
  try {
    const fixture = { database: 'Host', name: 'Calendar', folderLayout: 3, dashboardOwner: 'other-dashboard' };
    const id = await createDatabaseViewThroughApi(page, request, fixture);

    // Discard the live browser: an unsynced local-only marker cannot satisfy this.
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(server));
    const saved = (reopened.getMap('data').get('database') as Y.Map<unknown>).get('views') as Y.Map<Y.Map<unknown>>;

    expect(commands).toHaveLength(1);
    expect(commands[0].extra).toEqual({ dashboard_owner: 'other-dashboard' });
    expect(folderExtra?.dashboard_owner).toBe('other-dashboard');
    expect(saved.get(id)?.get('dashboard_owner')).toBe('other-dashboard');
    expect(saved.get(id)?.get('layout')).toBe(2);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    server.destroy(); browser.destroy(); reopened.destroy();
  }
});
