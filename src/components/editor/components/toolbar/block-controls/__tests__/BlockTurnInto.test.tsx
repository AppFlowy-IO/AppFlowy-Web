import { act, fireEvent, render, screen } from '@testing-library/react';
import { createEditor, Transforms } from 'slate';
import { Slate, withReact } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType, YjsEditorKey } from '@/application/types';
import { DEFAULT_CALLOUT_DATA } from '@/components/editor/components/blocks/callout/callout.utils';
import { BlockNode } from '@/components/editor/editor.type';

import { BlockTurnInto } from '../BlockTurnInto';
import { useBlockMenuNode } from '../useBlockMenuNode';

import type { ReactNode } from 'react';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/slate-yjs/command', () => ({ CustomEditor: { turnToBlock: jest.fn() } }));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}));

function block(type = BlockType.Paragraph): BlockNode {
  return {
    blockId: 'selected',
    type,
    data: {},
    children: [{ type: YjsEditorKey.text, children: [{ text: 'Original text' }] }],
  } as BlockNode;
}

function setup(node = block(), locked = false) {
  const editor = withReact(createEditor());
  const close = jest.fn();

  editor.isElementReadOnly = () => locked;
  render(
    <Slate editor={editor} initialValue={[node]}>
      <BlockTurnInto node={node} onClose={close} />
    </Slate>
  );
  return { editor, close };
}

beforeEach(() => jest.clearAllMocks());

it.each([
  BlockType.Paragraph,
  BlockType.HeadingBlock,
  BlockType.BulletedListBlock,
  BlockType.NumberedListBlock,
  BlockType.TodoListBlock,
  BlockType.ToggleListBlock,
  BlockType.QuoteBlock,
  BlockType.CodeBlock,
])('uses the shared conversion command for %s → callout', (type) => {
  const { editor, close } = setup(block(type));

  fireEvent.click(screen.getByRole('button', { name: 'document.plugins.optionAction.turnInto' }));
  fireEvent.click(screen.getByRole('button', { name: 'document.slashMenu.name.callout' }));
  expect(CustomEditor.turnToBlock).toHaveBeenCalledWith(
    editor,
    'selected',
    BlockType.CalloutBlock,
    DEFAULT_CALLOUT_DATA
  );
  expect(close).toHaveBeenCalledTimes(1);
});

it('keeps heading levels distinct and does not reset the current block type', () => {
  const node = { ...block(BlockType.HeadingBlock), data: { level: 2 } };
  const { editor } = setup(node);

  fireEvent.click(screen.getByRole('button', { name: 'document.plugins.optionAction.turnInto' }));
  expect(screen.getByRole('button', { name: 'document.slashMenu.name.heading2' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'document.slashMenu.name.heading1' }));
  expect(CustomEditor.turnToBlock).toHaveBeenCalledWith(editor, 'selected', BlockType.HeadingBlock, { level: 1 });
});

it.each([BlockType.SimpleTableBlock, BlockType.GridBlock, BlockType.ImageBlock, BlockType.OutlineBlock])(
  'does not offer text conversion for %s',
  (type) => {
    setup(block(type));
    expect(screen.queryByRole('button')).toBeNull();
  }
);

it('does not offer conversion for a locked block', () => {
  setup(block(), true);
  expect(screen.queryByRole('button')).toBeNull();
});

it('handles a block removed while its submenu is open', async () => {
  const { editor, close } = setup();

  fireEvent.click(screen.getByRole('button', { name: 'document.plugins.optionAction.turnInto' }));
  await act(async () => {
    Transforms.removeNodes(editor, { at: [0] });
  });
  fireEvent.click(screen.getByRole('button', { name: 'document.slashMenu.name.callout' }));
  expect(CustomEditor.turnToBlock).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});

it('subscribes to the selected block without rerendering for unrelated block edits', async () => {
  const editor = withReact(createEditor());
  const renderNode = jest.fn();

  function SelectedNode() {
    const node = useBlockMenuNode('selected');

    renderNode(node);
    return <output>{JSON.stringify(node?.data ?? null)}</output>;
  }

  render(
    <Slate editor={editor} initialValue={[block(), { ...block(), blockId: 'other' }]}>
      <SelectedNode />
    </Slate>
  );
  const initialRenders = renderNode.mock.calls.length;

  await act(async () => {
    Transforms.setNodes(editor, { data: { bgColor: 'other' } }, { at: [1] });
  });
  expect(renderNode).toHaveBeenCalledTimes(initialRenders);
  await act(async () => {
    Transforms.setNodes(editor, { data: { bgColor: 'updated' } }, { at: [0] });
  });
  expect(screen.getByRole('status').textContent).toBe('{"bgColor":"updated"}');
  await act(async () => {
    Transforms.removeNodes(editor, { at: [0] });
  });
  expect(screen.getByRole('status').textContent).toBe('null');
});
