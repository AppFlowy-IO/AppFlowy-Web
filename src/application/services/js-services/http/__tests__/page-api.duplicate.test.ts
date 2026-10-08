import { Element } from 'slate';
import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { BlockType, ViewLayout, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';
import { prepareSubpageFragment } from '@/components/editor/subpage/subpage-operations';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';

import { getCollab } from '../collab-api';
import { getAxios } from '../core';
import { duplicatePage } from '../page-api';

jest.mock('../collab-api', () => ({ getCollab: jest.fn() }));
jest.mock('../../workspace-database-catalog', () => ({ getDatabaseIdFromWorkspaceCatalog: jest.fn() }));

jest.mock('../core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data,
  executeAPIVoidRequest: async (request: () => Promise<unknown>) => {
    await request();
  },
}));

const source = { view_id: 'source', parent_view_id: 'parent', name: 'Child', layout: ViewLayout.Document };
const copy = { ...source, view_id: 'copy', name: 'Child (Copy)' };
const response = (data: unknown) => ({ data: { data } });

const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');

beforeEach(() => {
  jest.clearAllMocks();
  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true } });
});

afterEach(() => {
  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true } });
});

it.each([
  [6, undefined, true],
  [7, undefined, false],
  [3, 3, true],
  [3, 2, false],
  [1, 0, false],
] as const)('preflights whole-database copy with %i usable views and limit %s before queueing', async (count, limit, allowed) => {
  const databaseId = '550e8400-e29b-41d4-a716-446655440000';
  const databaseView = { ...source, layout: ViewLayout.Grid, extra: { database_id: databaseId }, children: [] };
  const document = new Y.Doc({ guid: databaseId });
  const database = new Y.Map();
  const views = new Y.Map();

  document.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views);
  views.set(uuidv5('inline_view_id', databaseId), new Y.Map());
  for (let index = 0; index < count; index += 1) views.set(`view-${index}`, new Y.Map());
  jest.mocked(getCollab).mockResolvedValue({ data: Y.encodeStateAsUpdate(document) });
  document.destroy();
  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, max_database_views: limit } });
  const get = jest.fn().mockResolvedValue(response(databaseView));
  const post = jest.fn().mockResolvedValue({ headers: {} });

  jest.mocked(getAxios).mockReturnValue({ get, post } as never);
  const operation = duplicatePage('workspace', 'source');

  if (allowed) {
    await expect(operation).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
  } else {
    await expect(operation).rejects.toThrow(`limit of ${limit ?? 6} views`);
    expect(post).not.toHaveBeenCalled();
  }
});

it('checks a nested database only once and refuses to queue when its source cannot be read', async () => {
  const databaseId = '550e8400-e29b-41d4-a716-446655440000';
  const databaseView = { ...source, layout: ViewLayout.Grid, extra: { database_id: databaseId }, children: [] };
  const get = jest.fn().mockResolvedValue(response({
    ...source,
    children: [databaseView, { ...databaseView, view_id: 'second-view' }],
  }));
  const post = jest.fn();

  jest.mocked(getCollab).mockRejectedValue(new Error('Database is unavailable'));
  jest.mocked(getAxios).mockReturnValue({ get, post } as never);

  await expect(duplicatePage('workspace', 'source')).rejects.toThrow('Database is unavailable');
  expect(getCollab).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
});

it('uses the server task result to bind the new block to the exact duplicate', async () => {
  const get = jest.fn(async (url: string) => {
    if (url.endsWith('/duplicate/task')) return response({ result: { duplicated_view_id: 'copy' } });
    if (url.includes('/view/source?')) return response(source);
    if (url.includes('/view/copy?')) return response(copy);
    return response({ view_id: 'parent', children: [source] });
  });
  const post = jest.fn().mockResolvedValue({ headers: { 'x-appflowy-duplicate-task-id': 'task' } });
  jest.mocked(getAxios).mockReturnValue({ get, post } as never);
  const received = jest.fn();
  await duplicatePage('workspace', 'source', { parentViewId: 'parent', includeChildren: true }, received);
  expect(received).toHaveBeenCalledWith('copy');
  expect(get).toHaveBeenCalledWith('/api/workspace/workspace/page-view/source/duplicate/task');
});

it('supports older servers without a task ID and moves the duplicate to the paste destination', async () => {
  let completed = false;
  const get = jest.fn(async (url: string) => {
    if (url.includes('/view/source?')) return response(source);
    if (url.includes('/view/copy?')) return response(copy);
    if (url.includes('/view/destination?')) return response({ view_id: 'destination', children: [] });
    return response({ view_id: 'parent', children: completed ? [source, copy] : [source] });
  });
  const post = jest.fn(async () => {
    completed = true;
    return { headers: {} };
  });
  jest.mocked(getAxios).mockReturnValue({ get, post } as never);
  const received = jest.fn();
  await duplicatePage('workspace', 'source', { parentViewId: 'destination' }, received);
  expect(received).toHaveBeenCalledWith('copy');
  expect(post).toHaveBeenCalledWith('/api/workspace/workspace/page-view/copy/move', {
    new_parent_view_id: 'destination',
    prev_view_id: undefined,
  });
});

it('rejects ambiguous legacy duplicates instead of linking another user’s page', async () => {
  let completed = false;
  const get = jest.fn(async (url: string) => {
    if (url.includes('/view/source?')) return response(source);
    return response({
      view_id: 'parent',
      children: completed ? [source, copy, { ...copy, view_id: 'another-copy' }] : [source],
    });
  });
  const post = jest.fn(async () => {
    completed = true;
    return { headers: {} };
  });
  jest.mocked(getAxios).mockReturnValue({ get, post } as never);
  const received = jest.fn();
  await expect(duplicatePage('workspace', 'source', {}, received)).rejects.toThrow('Could not identify');
  expect(received).not.toHaveBeenCalled();
});

it.each(['metadata lookup', 'move'])('rolls back an identified duplicate if its %s fails', async (failure) => {
  const error = new Error(`${failure} failed`);
  const get = jest.fn(async (url: string) => {
    if (url.endsWith('/duplicate/task')) return response({ result: { duplicated_view_id: 'copy' } });
    if (url.includes('/view/source?')) return response(source);
    if (url.includes('/view/copy?')) {
      if (failure === 'metadata lookup') throw error;
      return response(copy);
    }
    return response({ view_id: 'parent', children: [source] });
  });
  const post = jest.fn(async (url: string) => {
    if (url.endsWith('/move')) throw error;
    return { headers: { 'x-appflowy-duplicate-task-id': 'task' } };
  });
  jest.mocked(getAxios).mockReturnValue({ get, post } as never);
  const context: EditorContextState = {
    workspaceId: 'workspace',
    viewId: 'destination',
    readOnly: false,
    duplicatePage: (viewId, options) => duplicatePage('workspace', viewId, options, options?.onDuplicated),
    deletePage: jest.fn().mockResolvedValue(undefined),
  };
  const fragment: Element[] = [{ type: BlockType.SubpageBlock, data: { view_id: 'source' }, children: [{ text: '' }] }];

  await expect(prepareSubpageFragment(fragment, context)).rejects.toThrow(error);
  expect(context.deletePage).toHaveBeenCalledTimes(1);
  expect(context.deletePage).toHaveBeenCalledWith('copy');
});
