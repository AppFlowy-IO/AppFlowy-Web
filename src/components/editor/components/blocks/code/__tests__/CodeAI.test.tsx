import { act, fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';

import { BlockType } from '@/application/types';
import { ModelSelectorContext } from '@/components/chat/contexts/model-selector-context';
import { CodeNode } from '@/components/editor/editor.type';

import CodeAI from '../CodeAI';

let mockTranslate = (key: string) => key;
const mockAxios = jest.fn<object | undefined, []>(() => ({}));
const mockFetch = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('slate-react', () => ({ useSlateStatic: () => ({}), useReadOnly: () => false }));
jest.mock('@/application/services/js-services/http/core', () => ({ getAxios: () => mockAxios() }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ workspaceId: 'workspace', viewId: 'view' }),
}));
jest.mock('@/components/chat/request/writer-request', () => ({
  WriterRequest: jest.fn().mockImplementation(() => ({ fetchAIAssistant: mockFetch })),
}));
jest.mock('@/components/chat/components/chat-input/model-selector', () => ({
  ModelSelector: function TestModelSelector() {
    const context = useContext(ModelSelectorContext);

    return (
      <button type='button' onClick={() => context?.setSelectedModelName?.('Chosen model')}>
        Choose model
      </button>
    );
  },
}));
jest.mock('../CodeResponse', () => ({
  CodeResponse: ({ content }: { content: string }) => <div>{content}</div>,
}));

const node = {
  type: BlockType.CodeBlock,
  blockId: 'code',
  data: { language: 'javascript' },
  children: [{ type: 'text', children: [{ text: 'const value = 1;' }] }],
} as CodeNode;

function setup(action: 'explain' | 'generate' = 'explain') {
  const requests: { signal: AbortSignal; modelName: string; emit: (text: string) => void; finish: () => void }[] = [];

  mockFetch.mockImplementation((options, emit) => {
    let finish!: () => void;
    const streamPromise = new Promise<void>((resolve) => {
      finish = resolve;
    });

    requests.push({ ...options, emit, finish });
    return Promise.resolve({ streamPromise });
  });
  const props = { node, action, onClose: jest.fn() };
  const rendered = render(<CodeAI {...props} />);

  return { ...rendered, props, requests };
}

beforeEach(() => {
  mockTranslate = (key) => key;
  mockAxios.mockReturnValue({});
  jest.clearAllMocks();
});

it('preserves a streaming response across translation changes without resubmitting or aborting', async () => {
  const { props, requests, rerender } = setup();

  await act(async () => requests[0].emit('First part'));
  mockTranslate = (key) => `translated:${key}`;
  rerender(<CodeAI {...props} />);
  expect(requests).toHaveLength(1);
  expect(requests[0].signal.aborted).toBe(false);
  expect(screen.getByText('First part')).toBeDefined();
  await act(async () => {
    requests[0].emit('Complete answer');
    requests[0].finish();
  });
  expect(screen.getByText('Complete answer')).toBeDefined();
  expect(screen.queryByTestId('code-ai-loading')).toBeNull();
});

it('uses the selected model only for the next user submission or retry', async () => {
  const { requests } = setup();

  await act(async () => {
    requests[0].emit('Answer');
    requests[0].finish();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
  expect(requests).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'button.tryAgain' }));
  expect(requests).toHaveLength(2);
  expect(requests[1].modelName).toBe('Chosen model');
});

it('does not submit Generate automatically and uses the current model on Send', () => {
  const { requests } = setup('generate');

  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Refine the code' } });
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  expect(requests).toHaveLength(1);
  expect(requests[0].modelName).toBe('Chosen model');
});

it('aborts on unmount and ignores late stream callbacks', async () => {
  const { requests, unmount } = setup();

  unmount();
  expect(requests[0].signal.aborted).toBe(true);
  await act(async () => {
    requests[0].emit('Late answer');
    requests[0].finish();
  });
  expect(requests).toHaveLength(1);
});

it('translates an unavailable-service error without retrying the request', async () => {
  mockAxios.mockReturnValue(undefined);
  const { props, rerender, requests } = setup();

  expect(screen.getByRole('alert').textContent).toBe('document.plugins.codeBlock.aiUnavailable');
  mockTranslate = (key) => `translated:${key}`;
  // Availability changes alone do not authorize another request.
  mockAxios.mockReturnValue({});
  rerender(<CodeAI {...props} />);
  expect(screen.getByRole('alert').textContent).toBe('translated:document.plugins.codeBlock.aiUnavailable');
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'translated:button.tryAgain' }));
  expect(requests).toHaveLength(1);
  await act(async () => requests[0].finish());
});
