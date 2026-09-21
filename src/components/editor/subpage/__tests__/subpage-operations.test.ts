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
  movePage: jest.fn().mockResolvedValue(undefined),
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
