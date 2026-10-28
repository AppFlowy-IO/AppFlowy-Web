import Prism from 'prismjs';
import type { Element } from 'slate';

import { supportLanguages } from '@/components/editor/components/blocks/code/constants';

import { codeLanguage, tokenizeCode } from '../code-languages';
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

it('bundles every native editor language and resolves aliases without a network loader', () => {
  for (const { id } of supportLanguages) expect(Prism.languages[codeLanguage(id)]).toBeDefined();
  expect(codeLanguage(' TS ')).toBe('typescript');
  expect(codeLanguage('C#')).toBe('csharp');
  expect(codeLanguage('HTML')).toBe('markup');
  expect(codeLanguage('auto')).toBe('plaintext');
  expect(codeLanguage('objectivec')).toBe('objectivec');
  expect(codeLanguage('asm')).toBe('nasm');
  expect(codeLanguage('vbnet')).toBe('vbnet');
});

function textOf(tokens: string | Prism.Token | Array<string | Prism.Token>): string {
  if (typeof tokens === 'string') return tokens;
  if (Array.isArray(tokens)) return tokens.map(textOf).join('');
  return textOf(tokens.content);
}

it.each(['typescript', 'python', 'tsx', 'unknown-language', undefined])(
  'preserves all source characters when highlighting %s',
  (language) => {
    const source = 'const html = `<script>${value}</script>`;\n\t// Indentation and blank lines\n\n  return html;';
    expect(textOf(tokenizeCode(source, language))).toBe(source);
  }
);

it('highlights keywords while leaving unsupported languages readable', () => {
  expect(tokenizeCode('interface Person {}', 'typescript')).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'keyword', content: 'interface' })])
  );
  expect(tokenizeCode('<custom syntax>', 'unknown-language')).toEqual(['<custom syntax>']);
});
