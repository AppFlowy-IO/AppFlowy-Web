import { BlockType } from '@/application/types';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { parsedBlockToSlateElement } from '@/components/editor/parsers/parsed-block-to-slate';

import { extractGeneratedCode } from '../code-ai';

describe('AI output must never replace code with prose or unrelated snippets', () => {
  test('extracts one complete fenced snippet, preserving Unicode and indentation', () => {
    expect(extractGeneratedCode('Explanation\n\n```python\n  print("你好 👋")\n\treturn 42\n```')).toEqual({
      language: 'python',
      text: '  print("你好 👋")\n\treturn 42',
    });
  });
  test.each(['no change is required', '```js\n```', '```js\nfirst\n```\n\n```js\nsecond\n```'])(
    'refuses ambiguous or empty output: %s',
    (value) => {
      expect(extractGeneratedCode(value)).toBeUndefined();
    }
  );
  test('Flutter code Markdown import preserves URL credentials literally (#5032)', () => {
    // Exact source from the issue attachment, with example (not real) credentials.
    const blocks = parseMarkdown('```bash\ncurl https://user_name:password@github.com\n```');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: BlockType.CodeBlock,
      text: 'curl https://user_name:password@github.com',
      data: { language: 'bash' },
      formats: [],
    });
    expect(parsedBlockToSlateElement(blocks[0]).children).toEqual([
      { type: 'text', children: [{ text: 'curl https://user_name:password@github.com' }] },
    ]);
  });
  test('Flutter unspecified-language code Markdown retains code block identity', () => {
    expect(parseMarkdown('```\nSome Code\n```')[0]).toMatchObject({
      type: BlockType.CodeBlock,
      text: 'Some Code',
      formats: [],
    });
  });
});
