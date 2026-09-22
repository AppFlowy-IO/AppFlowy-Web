import { Element, Node } from 'slate';

import { BlockType } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';

import { markSubpageClipboard, prepareSubpageFragment, queueSubpageOperation } from '../subpage-operations';

const page = (id: string, cut = false): Element => ({
  type: BlockType.SubpageBlock,
  data: { view_id: id, was_cut: cut },
  children: [{ text: '' }],
});
const context = (): EditorContextState => ({
  workspaceId: 'workspace',
  viewId: 'parent',
  readOnly: false,
  duplicatePage: jest.fn(async (id, options) => {
    options?.onDuplicated?.(`${id}-copy`);
  }),
  deletePage: jest.fn().mockResolvedValue(undefined),
  restorePage: jest.fn().mockResolvedValue(undefined),
  loadTrashViews: jest.fn().mockResolvedValue([{ view_id: 'cut', parent_view_id: 'original-parent' }]),
  movePage: jest.fn().mockResolvedValue(undefined),
  loadViewMeta: jest.fn().mockResolvedValue({ view_id: 'cut', parent_view_id: 'original-parent' }),
});

it('copies nested subpages with new IDs and preserves linked_page references', async () => {
  const ctx = context();
  const nodes: Node[] = [
    {
      type: BlockType.Paragraph,
      data: {},
      children: [page('a'), page('a'), { ...page('b'), type: BlockType.LinkedPageBlock }],
    },
  ];
  const { fragment } = await prepareSubpageFragment(nodes, ctx);
  const children = (fragment[0] as Element).children as Element[];
  expect(children.map((node) => node.data.view_id)).toEqual(['a-copy', 'a-copy', 'b']);
  expect(ctx.duplicatePage).toHaveBeenCalledTimes(1);
  expect(ctx.duplicatePage).toHaveBeenCalledWith(
    'a',
    expect.objectContaining({ parentViewId: 'parent', includeChildren: true, openAfterDuplicate: false })
  );
  expect((nodes[0] as Element).children[0]).toEqual(page('a'));
});

it('restores a cut subpage only after its pending deletion, then moves the same page', async () => {
  const ctx = context();
  let finishDelete!: () => void;
  const pending = queueSubpageOperation(
    'workspace',
    'cut',
    () =>
      new Promise<void>((resolve) => {
        finishDelete = resolve;
      })
  );
  const prepare = prepareSubpageFragment([page('cut', true)], ctx, true);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(ctx.restorePage).not.toHaveBeenCalled();
  expect(ctx.loadTrashViews).not.toHaveBeenCalled();
  finishDelete();
  await pending;
  const { fragment } = await prepare;
  expect(ctx.restorePage).toHaveBeenCalledWith('cut');
  expect(ctx.movePage).toHaveBeenCalledWith('cut', 'parent');
  expect(ctx.duplicatePage).not.toHaveBeenCalled();
  expect((fragment[0] as Element).data).toMatchObject({ view_id: 'cut', was_cut: false, was_copied: false });
});

it('cleans up earlier duplicates when a later child cannot be copied', async () => {
  const ctx = context();
  (ctx.duplicatePage as jest.Mock)
    .mockImplementationOnce(async (_, options) => options.onDuplicated('first-copy'))
    .mockRejectedValueOnce(new Error('No access'));
  await expect(prepareSubpageFragment([page('first'), page('second')], ctx)).rejects.toThrow('No access');
  expect(ctx.deletePage).toHaveBeenCalledWith('first-copy');
});

it('returns a cancelled cut paste to its original parent and trash state, only once', async () => {
  const ctx = context();
  const actions: string[] = [];
  ctx.restorePage = jest.fn(async () => {
    actions.push('restore');
  });
  ctx.movePage = jest.fn(async (_, parent) => {
    actions.push(`move:${parent}`);
  });
  ctx.deletePage = jest.fn(async () => {
    actions.push('trash');
  });
  const prepared = await prepareSubpageFragment([page('cut', true)], ctx, true);

  await prepared.rollback();
  await prepared.rollback();
  expect(actions).toEqual(['restore', 'move:parent', 'move:original-parent', 'trash']);
});

it('returns an active cut page to its original parent without trashing it on cancellation', async () => {
  const ctx = context();
  (ctx.loadTrashViews as jest.Mock).mockResolvedValue([]);
  const prepared = await prepareSubpageFragment([page('cut', true)], ctx, true);

  await prepared.rollback();
  expect(ctx.movePage).toHaveBeenNthCalledWith(1, 'cut', 'parent');
  expect(ctx.movePage).toHaveBeenNthCalledWith(2, 'cut', 'original-parent');
  expect(ctx.restorePage).not.toHaveBeenCalled();
  expect(ctx.deletePage).not.toHaveBeenCalled();
});

it('re-trashes a restored cut page when its move fails', async () => {
  const ctx = context();
  (ctx.movePage as jest.Mock).mockRejectedValueOnce(new Error('Move failed'));

  await expect(prepareSubpageFragment([page('cut', true)], ctx, true)).rejects.toThrow('Move failed');
  expect(ctx.restorePage).toHaveBeenCalledWith('cut');
  expect(ctx.deletePage).toHaveBeenCalledWith('cut');
  expect(ctx.movePage).toHaveBeenLastCalledWith('cut', 'original-parent');
});

it('compensates cut-page restoration and movement when a later duplicate fails', async () => {
  const ctx = context();
  (ctx.duplicatePage as jest.Mock).mockRejectedValueOnce(new Error('Copy failed'));

  await expect(prepareSubpageFragment([page('cut', true), page('copy')], ctx, true)).rejects.toThrow('Copy failed');
  expect(ctx.movePage).toHaveBeenLastCalledWith('cut', 'original-parent');
  expect(ctx.deletePage).toHaveBeenCalledWith('cut');
});

it('does not insert aliases when the duplicate operation cannot return a new page', async () => {
  const ctx = context();
  (ctx.duplicatePage as jest.Mock).mockResolvedValue(undefined);
  await expect(prepareSubpageFragment([page('child')], ctx)).rejects.toThrow('Could not find');
});

it('uses desktop-compatible copy and cut markers without mutating document data', () => {
  const original = page('child');
  expect((markSubpageClipboard([original], true)[0] as Element).data.was_cut).toBe(true);
  expect((markSubpageClipboard([original], false)[0] as Element).data.was_copied).toBe(true);
  expect(original.data.was_cut).toBe(false);
});
