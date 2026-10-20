import { act, renderHook } from '@testing-library/react';

import { BlockType } from '@/application/types';
import { CodeNode } from '@/components/editor/editor.type';

import { useCodeBlock } from '../Code.hooks';

const mockAddCodeGrammars = jest.fn();
const mockLoadHighlighter = jest.fn();
const mockHighlighter = {
  highlightAuto: jest.fn(() => ({ language: 'javascript' })),
  getLanguage: jest.fn(() => true),
};

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ addCodeGrammars: mockAddCodeGrammars }),
}));
jest.mock('../code-grammars', () => ({
  __esModule: true,
  get default() {
    mockLoadHighlighter();
    return mockHighlighter;
  },
}));

const code = (language = '', text = 'const value = 1;') =>
  ({
    type: BlockType.CodeBlock,
    blockId: 'code',
    data: { language },
    children: [{ type: 'text', children: [{ text }] }],
  } as CodeNode);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it.each([
  ['plaintext', 'const value = 1;'],
  ['', ''],
  ['', ' \n '],
])('keeps %s / %j readable without loading the syntax bundle', async (language, text) => {
  renderHook(() => useCodeBlock(code(language, text)));
  await act(async () => {
    jest.runAllTimers();
  });
  expect(mockAddCodeGrammars).toHaveBeenLastCalledWith('code', 'plaintext');
  expect(mockLoadHighlighter).not.toHaveBeenCalled();
});

it('skips stale Auto detection when typing continues while the syntax bundle loads', async () => {
  const { rerender } = renderHook(({ node }) => useCodeBlock(node), { initialProps: { node: code() } });

  // The timer starts an import; type again before that import resolves.
  void act(() => jest.advanceTimersByTime(150));
  rerender({ node: code('', 'const latest = 2;') });
  await act(async () => undefined);
  expect(mockHighlighter.highlightAuto).not.toHaveBeenCalled();
  expect(mockAddCodeGrammars).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(150);
  });
  expect(mockHighlighter.highlightAuto).toHaveBeenCalledTimes(1);
  expect(mockHighlighter.highlightAuto).toHaveBeenCalledWith('const latest = 2;');
  expect(mockAddCodeGrammars).toHaveBeenCalledWith('code', 'javascript');
});

it('does not detect or publish after the block unmounts during an import', async () => {
  const { unmount } = renderHook(() => useCodeBlock(code()));

  void act(() => jest.advanceTimersByTime(150));
  unmount();
  await act(async () => undefined);
  expect(mockHighlighter.highlightAuto).not.toHaveBeenCalled();
  expect(mockAddCodeGrammars).not.toHaveBeenCalled();
});

it('does not reload an explicit language when its source changes', async () => {
  const { rerender } = renderHook(({ node }) => useCodeBlock(node), {
    initialProps: { node: code('javascript') },
  });

  await act(async () => {
    jest.runAllTimers();
  });
  rerender({ node: code('javascript', 'const latest = 2;') });
  await act(async () => {
    jest.runAllTimers();
  });
  expect(mockLoadHighlighter).toHaveBeenCalledTimes(1);
  expect(mockHighlighter.highlightAuto).not.toHaveBeenCalled();
  expect(mockAddCodeGrammars).toHaveBeenCalledTimes(1);
});
