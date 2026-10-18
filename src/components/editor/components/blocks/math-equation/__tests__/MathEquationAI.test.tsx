import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { MathEquationAISession } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { MathEquationNode } from '@/components/editor/editor.type';
import { insertBlocksAtCaret } from '@/components/editor/utils/insert-blocks-at-caret';

import MathEquationAI from '../MathEquationAI';
import { extractGeneratedEquation } from '../math-equation-ai';

const mockT = (key: string) => key;
const mockFetch = jest.fn();
const mockEditor = {
  readOnly: false,
  isElementReadOnly: () => false,
  select: jest.fn(),
  end: () => ({ path: [0, 0, 0], offset: 0 }),
};
let mockNode: MathEquationNode;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('slate-react', () => ({ useReadOnly: () => mockEditor.readOnly, useSlateStatic: () => mockEditor }));
jest.mock('@/application/services/js-services/http/core', () => ({ getAxios: () => ({}) }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ workspaceId: 'workspace', viewId: 'view' }),
}));
jest.mock('@/components/chat/request/writer-request', () => ({
  WriterRequest: jest.fn().mockImplementation(() => ({ fetchAIAssistant: mockFetch })),
}));
jest.mock('@/application/slate-yjs/command', () => ({ CustomEditor: { setBlockData: jest.fn() } }));
jest.mock('@/application/slate-yjs/utils/editor', () => ({
  findSlateEntryByBlockId: () => (mockNode ? [mockNode, [0]] : undefined),
}));
jest.mock('@/components/editor/utils/insert-blocks-at-caret', () => ({ insertBlocksAtCaret: jest.fn(() => true) }));
jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));
jest.mock('@appflowyinc/editor', () => ({ EditorProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/chat/components/ai-writer/render-editor', () => ({
  RenderEditor: ({ content }: { content: string }) => <div>{content}</div>,
}));
jest.mock('@/components/chat/components/chat-input/model-selector', () => ({ ModelSelector: () => null }));

function respond(answer: string) {
  mockFetch.mockImplementation(async (_payload, onMessage) => {
    onMessage(answer, '', true);
    return { streamPromise: Promise.resolve(), cancel: jest.fn() };
  });
}

function setup(action: MathEquationAISession['action'], draft?: string) {
  const onClose = jest.fn();
  const session = { action, blockId: 'equation', draft };
  const result = render(<MathEquationAI node={mockNode} session={session} onClose={onClose} />);

  return { ...result, onClose, session };
}

describe('equation AI lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor.readOnly = false;
    mockNode = { type: BlockType.EquationBlock, blockId: 'equation', data: { formula: 'x+1=3' }, children: [] };
    respond('$$x=2$$');
  });

  it('carries the editing draft into AI and waits for explicit submit and insert', async () => {
    const { onClose } = setup('generate', 'Solve for x');

    expect(mockFetch).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox')).value).toBe('Solve for x');
    fireEvent.click(screen.getByRole('button', { name: 'document.plugins.mathEquation.send' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'document.plugins.mathEquation.insert' })).toBeTruthy()
    );
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls[0][0]).toMatchObject({
      assistantType: 8,
      inputText: 'Equation:\n$$\nx+1=3\n$$\n\nSolve for x',
    });
    fireEvent.click(screen.getByRole('button', { name: 'document.plugins.mathEquation.insert' }));
    expect(CustomEditor.setBlockData).toHaveBeenCalledWith(mockEditor, 'equation', { formula: 'x=2' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('explains automatically, retries the same request, and inserts formatted content below', async () => {
    respond('The variable $x$ is unknown.');
    setup('explain');
    await waitFor(() => expect(screen.getByRole('button', { name: 'button.tryAgain' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'button.tryAgain' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[1][0]).toEqual(mockFetch.mock.calls[0][0]);
    fireEvent.click(await screen.findByRole('button', { name: 'button.insertBelow' }));
    expect(insertBlocksAtCaret).toHaveBeenCalled();
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  });

  it('checks equations without inserting prose into the formula', async () => {
    respond('No change is required');
    setup('check');
    await screen.findByText('No change is required');
    const button = await screen.findByRole('button', { name: 'document.plugins.mathEquation.insert' });

    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(insertBlocksAtCaret).toHaveBeenCalled();
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  });

  it('rejects a result if a collaborator changed the source equation', async () => {
    const { rerender, onClose, session } = setup('check');

    await screen.findByRole('button', { name: 'document.plugins.mathEquation.insert' });
    mockNode = { ...mockNode, data: { formula: 'changed' } };
    rerender(<MathEquationAI node={mockNode} session={session} onClose={onClose} />);
    expect(
      (screen.getByRole('button', { name: 'document.plugins.mathEquation.insert' })).disabled
    ).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('changedDuringAI');
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  });

  it('aborts the request on close and never commits its late response', async () => {
    let finish!: () => void;

    mockFetch.mockImplementation(async () => ({
      streamPromise: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      cancel: jest.fn(),
    }));
    const { unmount } = setup('check');

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const signal = mockFetch.mock.calls[0][0].signal as AbortSignal;

    unmount();
    expect(signal.aborted).toBe(true);
    finish();
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  });

  it('shows failures and supports retry', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Offline'));
    setup('check');
    await screen.findByText('Offline');
    expect(screen.getAllByRole('button', { name: 'button.close' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'button.tryAgain' }));
    await screen.findByText('$$x=2$$');
  });

  it('shows an empty generation result without enabling Insert', async () => {
    respond('');
    setup('generate', 'Write a formula');
    fireEvent.click(screen.getByRole('button', { name: 'document.plugins.mathEquation.send' }));
    await screen.findByText('document.plugins.mathEquation.noEquation');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'document.plugins.mathEquation.insert' }).disabled).toBe(true);
    expect(screen.getAllByRole('button', { name: 'button.close' })).toHaveLength(1);
  });

  it('stops a partial result without allowing insertion and can retry', async () => {
    mockFetch.mockImplementation(async (_payload, onMessage) => {
      onMessage('$$partial$$', '', false);
      return { streamPromise: new Promise(() => undefined) };
    });
    setup('check');
    await screen.findByText('$$partial$$');
    fireEvent.click(screen.getByRole('button', { name: 'document.plugins.mathEquation.stop' }));
    expect(mockFetch.mock.calls[0][0].signal.aborted).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'document.plugins.mathEquation.insert' })).disabled
    ).toBe(true);
    respond('$$x=2$$');
    fireEvent.click(screen.getByRole('button', { name: 'button.tryAgain' }));
    await screen.findByText('$$x=2$$');
  });
});

describe('extractGeneratedEquation', () => {
  it.each([
    ['$$x=2$$', 'x=2'],
    ['```latex\nx=2\n```', 'x=2'],
    ['The result is $x=2$.', undefined],
    ['$x=2$', 'x=2'],
    ['No change is required', undefined],
    ['I cannot help.', undefined],
    ['$$x=1$$ $$y=2$$', 'x=1\ny=2'],
  ])('extracts only equation content: %s', (answer, formula) => expect(extractGeneratedEquation(answer)).toBe(formula));
});
