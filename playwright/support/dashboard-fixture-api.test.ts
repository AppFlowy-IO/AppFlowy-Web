/** @jest-environment node */
/* eslint-disable import/default, import/no-named-as-default-member -- protobufjs is CommonJS; Node ESM needs its default export. */
import { resolve } from 'node:path';

import protobuf from 'protobufjs';
import * as Y from 'yjs';

import { createFixtureFields, createFixtureView, syncFixtureDatabase } from './dashboard-fixture-api';

import type { CreateDefaultDatabaseViewRequest } from '../../src/application/atomic-creation/types';
import type { APIRequestContext } from '@playwright/test';

jest.mock('@playwright/test', () => ({
  expect: { poll: (read: () => Promise<unknown>) => ({ toBe: async (value: unknown) => expect(await read()).toBe(value) }) },
}));

const schema = protobuf.loadSync(resolve('src/proto/collab.proto'));
const requestType = schema.lookupType('collab.CollabBatchSyncRequest');
const responseType = schema.lookupType('collab.CollabBatchSyncResponse');
const asRequest = (post: jest.Mock, get?: jest.Mock) => ({ post, get }) as unknown as APIRequestContext;

function syncReply(error = '', missingUpdate = new Uint8Array(), acknowledged = true) {
  const body = responseType.encode(responseType.create({ results: [{
    objectId: 'database', collabType: 1, compression: 0, error, missingUpdate,
    ...(acknowledged ? { messageId: { timestamp: 123, sequence: 0 } } : {}),
  }] })).finish();

  return { ok: () => true, body: async () => body };
}

afterEach(() => jest.useRealTimers());

it('resends the same field update and version only after explicit sync backpressure', async () => {
  jest.useFakeTimers();
  const post = jest.fn().mockResolvedValueOnce(syncReply('retry_later')).mockResolvedValueOnce(syncReply());
  const pending = syncFixtureDatabase(asRequest(post), 'token', 'workspace', 'database', Uint8Array.of(1, 2, 3), 'version');

  await jest.runAllTimersAsync();
  await pending;
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[0][1].data).toEqual(post.mock.calls[1][1].data);
  const decoded = requestType.toObject(requestType.decode(post.mock.calls[1][1].data));

  expect(decoded.items[0]).toMatchObject({ objectId: 'database', collabVersion: 'version' });
});

it.each(['internal', 'permission_denied'])('fails sync immediately on %s', async (error) => {
  const post = jest.fn().mockResolvedValue(syncReply(error));

  await expect(syncFixtureDatabase(asRequest(post), 'token', 'workspace', 'database')).rejects.toThrow(error);
  expect(post).toHaveBeenCalledTimes(1);
});

it('requires a durable acknowledgement for uploaded fields', async () => {
  const post = jest.fn().mockResolvedValue(syncReply('', new Uint8Array(), false));

  await expect(syncFixtureDatabase(asRequest(post), 'token', 'workspace', 'database', Uint8Array.of(1)))
    .rejects.toThrow('no durable acknowledgement');
});

it('bounds sync backpressure retries', async () => {
  jest.useFakeTimers();
  const post = jest.fn().mockResolvedValue(syncReply('retry_later'));
  const result = expect(syncFixtureDatabase(asRequest(post), 'token', 'workspace', 'database')).rejects.toThrow('remained busy');

  await jest.runAllTimersAsync();
  await result;
  expect(post).toHaveBeenCalledTimes(8);
});

it('preserves existing fields and view settings and publishes each fixture field once', async () => {
  jest.useFakeTimers();
  const source = new Y.Doc();
  const server = new Y.Doc();

  try {
    const fields = new Y.Map([['title', new Y.Map<unknown>([['id', 'title'], ['name', 'Name'], ['is_primary', true]])]]);
    const orders = new Y.Array();

    orders.push([{ id: 'title' }]);
    const settings = new Y.Map([['title', new Y.Map([['visibility', 2]])]]);
    const view = new Y.Map<unknown>([['field_orders', orders], ['field_settings', settings]]);
    const database = new Y.Map<unknown>([['id', 'database'], ['fields', fields], ['views', new Y.Map([['grid', view]])]]);

    source.getMap('data').set('database', database);
    const initial = Y.encodeStateAsUpdate(source);

    Y.applyUpdate(server, initial);
    const post = jest.fn()
      .mockResolvedValueOnce(syncReply('', initial))
      .mockResolvedValueOnce(syncReply('retry_later'))
      .mockImplementation(async (_url, options) => {
        const decoded = requestType.toObject(requestType.decode(options.data));

        // An identical retransmission must not create a second field/order.
        Y.applyUpdate(server, decoded.items[0].docState);
        Y.applyUpdate(server, decoded.items[0].docState);
        return syncReply();
      });
    const get = jest.fn().mockImplementation(async () => {
      const stored = server.getMap('data').get('database') as Y.Map<Y.Map<Y.Map<unknown>>>;
      const data = [...stored.get('fields')!.values()].map((field) => ({ id: field.get('id'), name: field.get('name') }));

      return { ok: () => true, status: () => 200, text: async () => JSON.stringify({ code: 0, data }) };
    });
    const pending = createFixtureFields(asRequest(post, get), 'token', 'workspace', 'database', [
      { name: 'Status', type: 3, typeOptionData: { content: '{"options":[{"id":"todo","name":"Todo"}]}' } },
      { name: 'Points', type: 1, typeOptionData: {} },
    ]);

    await jest.runAllTimersAsync();
    const ids = await pending;
    const saved = (server.getMap('data').get('database') as Y.Map<unknown>).toJSON();

    expect(Object.keys(saved.fields)).toHaveLength(3);
    expect(saved.views.grid.field_orders).toEqual([{ id: 'title' }, { id: ids.Status }, { id: ids.Points }]);
    expect(saved.views.grid.field_settings.title.visibility).toBe(2);
    expect(saved.fields[ids.Status].type_option['3'].content).toContain('Todo');
    expect(get).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[1][1].data).toEqual(post.mock.calls[2][1].data);
  } finally {
    source.destroy();
    server.destroy();
  }
});

const command: CreateDefaultDatabaseViewRequest = {
  schema_version: 'v1', request_id: 'request', database_restore_id: 'restore',
  view: { database_id: 'database', view_id: 'view', parent_view_id: 'parent', source_view_id: null,
    layout: 9, name: 'Dashboard', embedded: false, responses_view_id: null, timezone_id: null },
};
const jsonReply = (body: unknown) => ({ ok: () => true, json: async () => body });

it('replays one immutable atomic view command after RetryLater', async () => {
  jest.useFakeTimers();
  const result = { view_id: 'view', database_id: 'database' };
  const post = jest.fn().mockResolvedValueOnce(jsonReply({ code: -5 }))
    .mockResolvedValueOnce(jsonReply({ code: 0, data: { request_id: 'request', outcome: 'already_applied', result } }));
  const pending = createFixtureView(asRequest(post), 'token', 'workspace', command);

  await jest.runAllTimersAsync();
  await expect(pending).resolves.toEqual(result);
  expect(post.mock.calls[0][1].data).toBe(post.mock.calls[1][1].data);
});

it('does not retry an internal error from atomic creation', async () => {
  const post = jest.fn().mockResolvedValue(jsonReply({ code: 1017, message: 'Internal server error' }));

  await expect(createFixtureView(asRequest(post), 'token', 'workspace', command)).rejects.toThrow('1017');
  expect(post).toHaveBeenCalledTimes(1);
});
