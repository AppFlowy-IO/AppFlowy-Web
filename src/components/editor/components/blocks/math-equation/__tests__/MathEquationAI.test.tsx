import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { MathEquationAISession } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { MathEquationNode } from '@/components/editor/editor.type';
import { insertBlocksAtCaret } from '@/components/editor/utils/insert-blocks-at-caret';

import { extractGeneratedEquation } from '../math-equation-ai';
import MathEquationAI from '../MathEquationAI';

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
jest.mock('../MathEquationResponse', () => ({
  MathEquationResponse: ({ content }: { content: string }) => <div>{content}</div>,
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
    expect(screen.getByRole('textbox').value).toBe('Solve for x');
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
    expect(screen.getByRole('button', { name: 'document.plugins.mathEquation.insert' }).disabled).toBe(true);
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
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'document.plugins.mathEquation.insert' }).disabled
    ).toBe(true);
    expect(screen.getAllByRole('button', { name: 'button.close' })).toHaveLength(1);
  });

  it('stops a partial result without allowing insertion and can retry', async () => {
    mockFetch.mockImplementation(async (_payload, onMessage) => {
      onMessage('$$partial$$', '', false);
      return { streamPromise: new Promise(() => undefined) };
    });
    setup('check');
    await screen.findByText('$$partial$$');
    expect(screen.getByTestId('math-equation-ai-loading')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'document.plugins.mathEquation.stop' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'document.plugins.mathEquation.insert' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'document.plugins.mathEquation.stop' }));
    expect(screen.queryByTestId('math-equation-ai-loading')).toBeNull();
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(mockFetch.mock.calls[0][0].signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'document.plugins.mathEquation.insert' }).disabled).toBe(true);
    respond('$$x=2$$');
    fireEvent.click(screen.getByRole('button', { name: 'button.tryAgain' }));
    await act(async () => mockFetch.mock.calls[0][1]('$$late response$$', '', true));
    await screen.findByText('$$x=2$$');
    expect(screen.queryByText('$$late response$$')).toBeNull();
  });

  it('shows the compact loading row before the first chunk, then restores the prompt on completion', async () => {
    let finish!: () => void;

    mockFetch.mockImplementation(async () => ({
      streamPromise: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    }));
    setup('explain');
    expect(screen.getByRole('status').textContent).toContain('document.plugins.mathEquation.generating');
    expect(
      screen.getByTestId('math-equation-ai-loading').querySelectorAll('.math-equation-ai-dots > span')
    ).toHaveLength(3);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'button.insertBelow' })).toBeNull();
    await act(async () => mockFetch.mock.calls[0][1]('The answer is **two**.', '', false));
    expect(screen.getByText('The answer is **two**.')).toBeTruthy();
    expect(screen.getByTestId('math-equation-ai-loading')).toBeTruthy();
    await act(async () => {
      finish();
    });
    expect(screen.queryByTestId('math-equation-ai-loading')).toBeNull();
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'button.insertBelow' }).disabled).toBe(false);
  });

  it('inserts TeX code fences as equation blocks, matching the response preview', async () => {
    respond('## Solution\n\n```tex\nx=2\n```');
    setup('explain');
    fireEvent.click(await screen.findByRole('button', { name: 'button.insertBelow' }));
    expect(jest.mocked(insertBlocksAtCaret).mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: BlockType.HeadingBlock }),
        expect.objectContaining({ type: BlockType.EquationBlock, data: { formula: 'x=2' } }),
      ])
    );
  });

  it('lets Escape stop generation before any response arrives', async () => {
    mockFetch.mockImplementation(async () => ({ streamPromise: new Promise(() => undefined) }));
    setup('check');
    fireEvent.keyDown(screen.getByRole('button', { name: 'document.plugins.mathEquation.stop' }), { key: 'Escape' });
    expect(mockFetch.mock.calls[0][0].signal.aborted).toBe(true);
    expect(screen.queryByTestId('math-equation-ai-loading')).toBeNull();
    expect(screen.getByRole('textbox')).toBeTruthy();
    await act(async () => mockFetch.mock.calls[0][1]('$$late response$$', '', true));
    expect(screen.queryByText('$$late response$$')).toBeNull();
  });
});

describe('extractGeneratedEquation', () => {
  it.each([
    ['$$x=2$$', 'x=2'],
    ['```latex\nx=2\n```', 'x=2'],
    ['```latex\n$$x=2$$\n```', 'x=2'],
    ['```latex\n\n```', undefined],
    ['The result is $x=2$.', undefined],
    ['$x=2$', 'x=2'],
    ['No change is required', undefined],
    ['I cannot help.', undefined],
    ['$$x=1$$ $$y=2$$', 'x=1\ny=2'],
  ])('extracts only equation content: %s', (answer, formula) => expect(extractGeneratedEquation(answer)).toBe(formula));
});
