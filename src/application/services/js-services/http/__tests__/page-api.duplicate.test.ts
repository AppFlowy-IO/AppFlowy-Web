import { Element } from 'slate';

import { BlockType, ViewLayout } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';
import { prepareSubpageFragment } from '@/components/editor/subpage/subpage-operations';

import { getAxios } from '../core';
import { duplicatePage } from '../page-api';

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
