import type { Element } from 'slate';

import highlighter from '@/components/editor/components/blocks/code/code-grammars';
import { supportLanguages } from '@/components/editor/components/blocks/code/constants';

import { codeGrammar, tokenizeCode } from '../code-languages';
import { snapshotFromSlate } from '../snapshot-adapter';
import { parseMarkdown } from '../source';

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

it('retains formulas and code language settings from real editor blocks without changing their source', () => {
  const formula = String.raw`\frac{1}{2} + \sqrt{x}`;
  const code = 'const value = 42;\n\tconsole.log(value);';
  const source = {
    type: 'page',
    children: [
      { type: 'math_equation', data: { formula }, children: [{ text: '' }] },
      { type: 'code', data: { language: 'typescript' }, children: [{ type: 'text', children: [{ text: code }] }] },
      { type: 'math_equation', children: [{ text: '' }] },
    ],
  } as unknown as Element;
  const before = JSON.stringify(source);
  const snapshot = snapshotFromSlate('page', 'Equations and code', source);

  expect(snapshot.blocks[0]).toMatchObject({ type: 'math_equation', formula, text: formula });
  expect(snapshot.blocks[1]).toMatchObject({ type: 'code', language: 'typescript', text: code });
  expect(snapshot.blocks[2]).toMatchObject({ type: 'math_equation', formula: '', text: '' });
  expect(JSON.stringify(source)).toBe(before);
});

it('carries Markdown fence language and indentation into a read-only snapshot', () => {
  const snapshot = parseMarkdown('```python\ndef total(values):\n    return sum(values)\n```');
  expect(snapshot.blocks[0]).toMatchObject({
    type: 'code',
    language: 'python',
    text: 'def total(values):\n    return sum(values)\n',
  });
});

it('uses the editor grammar for every native language, alias and Auto block without a network loader', () => {
  for (const { id } of supportLanguages.filter(({ id }) => id !== 'auto'))
    expect(codeGrammar(highlighter, '', id)).toBe(id);
  expect(codeGrammar(highlighter, '', ' TS ')).toBe('typescript');
  expect(codeGrammar(highlighter, '', 'C#')).toBe('cs');
  expect(codeGrammar(highlighter, '', 'HTML')).toBe('html');
  expect(codeGrammar(highlighter, '', 'objectivec')).toBe('objective-c');
  expect(codeGrammar(highlighter, '', 'asm')).toBe('assembly');
  expect(codeGrammar(highlighter, '', 'vbnet')).toBe('visual basic');
  // Auto detects the language from the source, as in the editor.
  const rust =
    'fn main() {\n    let mut items: Vec<i32> = vec![1, 2, 3];\n    for item in &items { println!("{}", item); }\n}';

  expect(codeGrammar(highlighter, rust, 'auto')).toBe('rust');
});

it.each(['typescript', 'python', 'tsx', 'unknown-language', undefined])(
  'preserves all source characters when highlighting %s',
  (language) => {
    const source = 'const html = `<script>${value}</script>`;\n\t// Indentation and blank lines\n\n  return html;';
    const tokens = tokenizeCode(source, codeGrammar(highlighter, source, language));

    expect(tokens.map(({ text }) => text).join('')).toBe(source);
  }
);

it('highlights keywords with the editor token names while leaving unsupported languages readable', () => {
  expect(tokenizeCode('interface Person {}', 'typescript')).toEqual(
    expect.arrayContaining([{ text: 'interface', token: 'keyword' }])
  );
  expect(tokenizeCode('<custom syntax>', codeGrammar(highlighter, '<custom syntax>', 'unknown-language'))).toEqual([
    { text: '<custom syntax>', token: '' },
  ]);
});
