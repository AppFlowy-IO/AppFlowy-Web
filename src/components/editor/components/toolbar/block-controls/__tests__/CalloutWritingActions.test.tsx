import { act, fireEvent, render, screen } from '@testing-library/react';
import { createEditor, Transforms } from 'slate';
import { Slate, withReact } from 'slate-react';

import { BlockType, YjsEditorKey } from '@/application/types';
import { CalloutNode } from '@/components/editor/editor.type';

import { CalloutWritingActions } from '../CalloutBlockActions';

import type { ReactNode } from 'react';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/app.hooks', () => ({ useAIEnabled: () => true }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ canComment: true }),
  useEditorLocalState: () => ({}),
}));
jest.mock('@/components/inline-comment/InlineCommentContext', () => ({
  useInlineCommentComposeOptional: () => ({ active: true, isEditorRegistered: () => true }),
}));
jest.mock('@/components/chat', () => ({
  AIAssistantType: {},
  AIWriterMenu: ({ children, input, open }: { children: ReactNode; input: string; open: boolean }) => (
    <div data-testid='writer' data-input={input} data-open={String(open)}>
      {children}
    </div>
  ),
}));

function setup(title: string, body: string) {
  const editor = withReact(createEditor());
  const node = {
    blockId: 'callout',
    type: BlockType.CalloutBlock,
    data: {},
    children: [
      { type: YjsEditorKey.text, children: [{ text: title }] },
      {
        blockId: 'child',
        type: BlockType.Paragraph,
        data: {},
        children: [{ type: YjsEditorKey.text, children: [{ text: body }] }],
      },
    ],
  } as CalloutNode;

  render(
    <Slate editor={editor} initialValue={[node]}>
      <CalloutWritingActions node={node} onClose={jest.fn()} />
    </Slate>
  );
  return editor;
}

it('enables AI for body-only callouts and selects the whole block', async () => {
  const editor = setup('', 'Body text');

  expect(screen.getByRole('button', { name: 'document.plugins.optionAction.comment' }).disabled).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'editor.askAI' }));
  });
  expect(screen.getByTestId('writer').getAttribute('data-open')).toBe('true');
  expect(editor.selection?.focus).toEqual({ path: [0, 1, 0, 0], offset: 9 });
});

it('preserves a line break between title and body in AI input', () => {
  setup('Title', 'Body');
  expect(screen.getByTestId('writer').getAttribute('data-input')).toBe('Title\nBody');
});

it('does not enable AI for an entirely empty callout', () => {
  setup('', '');
  expect(screen.getByRole('button', { name: 'editor.askAI' }).disabled).toBe(true);
});

it('does not select an old node after it was deleted', async () => {
  const editor = setup('Title', 'Body');

  await act(async () => {
    Transforms.removeNodes(editor, { at: [0] });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'editor.askAI' }));
  });
  expect(screen.getByTestId('writer').getAttribute('data-open')).toBe('false');
});
