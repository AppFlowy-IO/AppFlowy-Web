import { render, waitFor } from '@testing-library/react';

import DocumentCode from '../DocumentCode';

import type { SourceBlock } from '../types';

const mockGrammarLoads = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// Count reads of the lazily imported grammar bundle while keeping the editor's real highlighter.
jest.mock('@/components/editor/components/blocks/code/code-grammars', () => {
  const actual = jest.requireActual('@/components/editor/components/blocks/code/code-grammars');

  return {
    __esModule: true,
    get default() {
      mockGrammarLoads();
      return actual.default;
    },
  };
});

const code = (id: string, text: string, language?: string): SourceBlock => ({
  id,
  type: 'code',
  text,
  language,
  children: [],
});

test('plain text stays readable without loading the editor grammars', async () => {
  const text = '<script>window.injected = true</script>\n\tUntouched whitespace';
  const { container } = render(<DocumentCode block={code('plain', text, 'plaintext')} />);

  await new Promise((resolve) => setTimeout(resolve));
  expect(container.querySelector('code')?.textContent).toBe(text);
  expect(container.querySelector('.token')).toBeNull();
  expect(container.querySelector('.ps-code-heading')?.textContent).toBe('Plain text');
  expect(mockGrammarLoads).not.toHaveBeenCalled();
});

test('highlights with the editor grammar and its token classes, then reuses it on the next copy', async () => {
  const text = 'interface Person {\n  name: string;\n}';
  const block = code('ts', text, 'typescript');
  const { container } = render(<DocumentCode block={block} />);

  await waitFor(() => expect(container.querySelector('.token.keyword')?.textContent).toBe('interface'));
  // highlight.js scopes, mapped as the editor's leaves map them (`hljs-title class_`).
  expect(container.querySelector('.token.title.class')?.textContent).toBe('Person');
  expect(mockGrammarLoads).toHaveBeenCalled();
  expect(container.querySelector('code')?.textContent).toBe(text);
  expect(container.querySelector('[data-code-language]')?.getAttribute('data-code-language')).toBe('typescript');
  expect(container.querySelector('.ps-code-heading')?.textContent).toBe('TypeScript');
  // A revisit or the measuring copy highlights on its first render.
  const copy = render(<DocumentCode block={block} />);

  expect(copy.container.querySelector('.token.keyword')?.textContent).toBe('interface');
});

test('Auto blocks detect their language like the editor instead of staying plain text', async () => {
  const text =
    'fn main() {\n    let mut items: Vec<i32> = vec![1, 2, 3];\n    for item in &items { println!("{}", item); }\n}';
  const { container } = render(<DocumentCode block={code('auto', text)} />);

  await waitFor(() => expect(container.querySelector('.token.keyword')?.textContent).toBe('fn'));
  expect(container.querySelector('code')?.textContent).toBe(text);
  expect(container.querySelector('.ps-code-heading')?.textContent).toBe('Auto');
  expect(mockGrammarLoads).toHaveBeenCalled();
});
