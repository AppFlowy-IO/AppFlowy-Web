import { createEditor, Editor, Node, Text, Transforms } from 'slate';
import { withHistory } from 'slate-history';
import { ReactEditor, withReact } from 'slate-react';

import { RichTextDelta, richTextToPlainText } from '@/application/database-yjs/fields/text/rich-text';

import {
  flattenFragmentToTexts,
  richTextToSlateValue,
  slateValueToRichText,
  toggleEquation,
  withRichTextCell,
} from '../rich-text-slate';

function makeEditor(text = '', singleLine = false) {
  const editor = withRichTextCell(withReact(withHistory(createEditor())), { singleLine }) as ReactEditor;

  editor.children = richTextToSlateValue(text ? [{ insert: text }] : []);
  Transforms.select(editor, Editor.end(editor, []));
  return editor;
}

function typeText(editor: ReactEditor, text: string) {
  for (const char of text) editor.insertText(char);
}

function delta(editor: ReactEditor) {
  return slateValueToRichText(editor.children);
}

function transfer(data: Record<string, string>) {
  return { getData: (type: string) => data[type] ?? '' } as unknown as DataTransfer;
}

function encodeFragment(fragment: unknown) {
  return window.btoa(encodeURIComponent(JSON.stringify(fragment)));
}

describe('rich text cell slate model', () => {
  it('round-trips a delta and merges adjacent runs with equal marks', () => {
    const value = richTextToSlateValue([
      { insert: 'a' },
      { insert: 'b' },
      { insert: 'c', attributes: { bold: true } },
      { insert: '$', attributes: { formula: 'x' } },
      { insert: '$', attributes: { formula: 'y' } },
    ]);

    expect(slateValueToRichText(value)).toEqual([
      { insert: 'ab' },
      { insert: 'c', attributes: { bold: true } },
      { insert: '$', attributes: { formula: 'x' } },
      { insert: '$', attributes: { formula: 'y' } },
    ]);
  });

  it('drops marks a cell does not keep', () => {
    const value = richTextToSlateValue([
      { insert: 'x', attributes: { bold: true, prism_token: 'keyword', 'comment-ids': ['c'] } },
    ]);

    expect(slateValueToRichText(value)).toEqual([{ insert: 'x', attributes: { bold: true } }]);
  });

  it('turns breaks into line breaks inside the one paragraph', () => {
    const editor = makeEditor('one');

    editor.insertBreak();
    typeText(editor, 'two');
    editor.insertSoftBreak();
    typeText(editor, 'three');

    expect(editor.children).toHaveLength(1);
    expect(delta(editor)).toEqual([{ insert: 'one\ntwo\nthree' }]);
  });

  it.each([
    ['**bold**', 'bold', { bold: true }],
    ['__bold__', 'bold', { bold: true }],
    ['*it*', 'it', { italic: true }],
    ['_it_', 'it', { italic: true }],
    ['~~gone~~', 'gone', { strikethrough: true }],
    ['~gone~', 'gone', { strikethrough: true }],
    ['`code`', 'code', { code: true }],
  ])('applies inline markdown %s', (source, text, attributes) => {
    const editor = makeEditor('Say ');

    typeText(editor, source);
    expect(delta(editor)).toEqual([{ insert: 'Say ' }, { insert: text, attributes }]);

    // Typing after the shortcut is plain again.
    typeText(editor, '!');
    expect(delta(editor).at(-1)).toEqual({ insert: '!' });
  });

  it('turns $$latex$$ into an inline equation but leaves single $ alone', () => {
    const editor = makeEditor();

    typeText(editor, '$$E=mc^2$$ and $x$');
    expect(delta(editor)).toEqual([
      { insert: '$', attributes: { formula: 'E=mc^2' } },
      { insert: ' and $x$' },
    ]);
  });

  it.each([
    'Costs $5 and $6',
    'Price $5-$10',
    'Range ~5 to ~10 days',
    'Compute 2*3*4',
    'Keep snake_case_name',
    'Spaced * not italic *',
    'Wrapped ** not bold **',
  ])('keeps "%s" as plain text', (text) => {
    const editor = makeEditor();

    typeText(editor, text);
    expect(delta(editor)).toEqual([{ insert: text }]);
  });

  it.each([
    ['a mention', { mention: { type: 'person', person_id: 'u1', person_name: 'Ada' } }],
    ['an equation', { formula: 'x^2' }],
  ])('keeps text typed after %s out of it', (_label, attributes) => {
    const editor = makeEditor();

    Transforms.insertNodes(editor, [{ text: '@', ...attributes } as Text], { select: true });
    typeText(editor, ' then text');
    expect(delta(editor)).toEqual([{ insert: '@', attributes }, { insert: ' then text' }]);
  });

  describe('typing at a chip', () => {
    const ada = { type: 'person', person_id: 'u1', person_name: 'Ada' };

    function editorWith(value: RichTextDelta) {
      const editor = makeEditor();

      editor.children = richTextToSlateValue(value);
      Transforms.select(editor, Editor.end(editor, []));
      return editor;
    }

    it.each([
      ['a mention', { mention: ada }],
      ['an equation', { formula: 'a^2' }],
    ])('keeps text typed right before %s out of it', (_label, attributes) => {
      const editor = editorWith([{ insert: 'Ask ' }, { insert: '@', attributes }, { insert: ' now' }]);

      // Where one Left arrow from after the chip puts the caret.
      Transforms.select(editor, { path: [0, 1], offset: 0 });
      typeText(editor, 'xy');
      expect(delta(editor)).toEqual([{ insert: 'Ask xy' }, { insert: '@', attributes }, { insert: ' now' }]);
    });

    it('gives text typed before a chip the format of the text before it', () => {
      const editor = editorWith([
        { insert: 'Ask', attributes: { bold: true } },
        { insert: '$', attributes: { formula: 'a^2' } },
      ]);

      Transforms.select(editor, { path: [0, 1], offset: 0 });
      typeText(editor, 'x');
      expect(delta(editor)).toEqual([
        { insert: 'Askx', attributes: { bold: true } },
        { insert: '$', attributes: { formula: 'a^2' } },
      ]);
    });

    it.each([
      [
        'in the middle',
        [{ insert: 'Ask ' }, { insert: '@', attributes: { mention: ada } }, { insert: ' now' }],
        1,
        'Ask x now',
      ],
      ['alone', [{ insert: '@', attributes: { mention: ada } }], 0, 'x'],
    ])('replaces a selected chip (%s) with the typed text', (_label, value, index, expected) => {
      const editor = editorWith(value as RichTextDelta);

      // Clicking a chip selects it.
      Transforms.select(editor, {
        anchor: { path: [0, index as number], offset: 0 },
        focus: { path: [0, index as number], offset: 1 },
      });
      typeText(editor, 'x');
      expect(delta(editor)).toEqual([{ insert: expected }]);
    });

    it('still keeps the format of selected text that is typed over', () => {
      const editor = editorWith([{ insert: 'Hello ' }, { insert: 'world', attributes: { bold: true } }]);

      Transforms.select(editor, { anchor: { path: [0, 1], offset: 0 }, focus: { path: [0, 1], offset: 5 } });
      typeText(editor, 'there');
      expect(delta(editor)).toEqual([{ insert: 'Hello ' }, { insert: 'there', attributes: { bold: true } }]);
    });
  });

  describe('identical chips side by side', () => {
    const ada = { type: 'person', person_id: 'u1', person_name: 'Ada' };
    const twoAdas: RichTextDelta = [
      { insert: 'Owners: ' },
      { insert: '$', attributes: { mention: ada } },
      { insert: '$', attributes: { mention: ada } },
      { insert: ' ok' },
    ];

    function editorWith(value: RichTextDelta) {
      const editor = makeEditor();

      editor.children = richTextToSlateValue(value);
      Transforms.select(editor, Editor.end(editor, []));
      return editor;
    }

    it('stay two chips through an edit, as Desktop stores them', () => {
      const editor = editorWith(twoAdas);

      typeText(editor, '!');
      expect(delta(editor)).toEqual([...twoAdas.slice(0, 3), { insert: ' ok!' }]);
      expect(richTextToPlainText(delta(editor))).toBe('Owners: @Ada@Ada ok!');

      const equations = editorWith([
        { insert: 'Eq ' },
        { insert: '$', attributes: { formula: 'x' } },
        { insert: '$', attributes: { formula: 'x' } },
      ]);

      typeText(equations, '!');
      expect(richTextToPlainText(delta(equations))).toBe('Eq xx!');
    });

    it('survive an undo of the edit', () => {
      const editor = editorWith(twoAdas);

      typeText(editor, '!');
      editor.undo();
      typeText(editor, '?');
      expect(richTextToPlainText(delta(editor))).toBe('Owners: @Ada@Ada ok?');
    });

    it('are read from a stored run of placeholders, and stray text in a chip reads as text', () => {
      const editor = editorWith([{ insert: '@@x', attributes: { mention: ada, bold: true } }, { insert: ' end' }]);

      typeText(editor, '!');
      expect(delta(editor)).toEqual([
        { insert: '@', attributes: { mention: ada, bold: true } },
        { insert: '@', attributes: { mention: ada, bold: true } },
        { insert: 'x', attributes: { bold: true } },
        { insert: ' end!' },
      ]);
    });

    it('stay two when the space between them is deleted', () => {
      const editor = editorWith([
        { insert: 'cc ' },
        { insert: '@', attributes: { mention: ada } },
        { insert: ' ' },
        { insert: '@', attributes: { mention: ada } },
      ]);

      Transforms.delete(editor, { at: { anchor: { path: [0, 2], offset: 0 }, focus: { path: [0, 2], offset: 1 } } });
      expect(richTextToPlainText(delta(editor))).toBe('cc @Ada@Ada');
    });

    it('stay two when the same chip is pasted twice or the same equation typed twice', () => {
      const editor = makeEditor('x ');
      const chip = transfer({ 'application/x-slate-fragment': encodeFragment([{ text: '@', mention: ada }]) });

      editor.insertData(chip);
      editor.insertData(chip);
      expect(richTextToPlainText(delta(editor))).toBe('x @Ada@Ada');

      const equations = makeEditor();

      typeText(equations, '$$x$$$$x$$');
      expect(delta(equations)).toEqual([
        { insert: '$', attributes: { formula: 'x' } },
        { insert: '$', attributes: { formula: 'x' } },
      ]);
    });
  });

  it('copies in the document block shape, which another cell reads back', () => {
    const ada = { type: 'person', person_id: 'u1', person_name: 'Ada' };
    const editor = makeEditor();

    editor.children = richTextToSlateValue([
      { insert: 'Hello ' },
      { insert: 'world', attributes: { bold: true } },
      { insert: '@', attributes: { mention: ada } },
    ]);
    Transforms.select(editor, Editor.range(editor, []));

    const fragment = editor.getFragment();

    // No transient chip key reaches the clipboard.
    expect(fragment).toEqual([
      {
        type: 'paragraph',
        data: {},
        children: [
          { type: 'text', children: [{ text: 'Hello ' }, { text: 'world', bold: true }, { text: '@', mention: ada }] },
        ],
      },
    ]);

    const target = makeEditor();

    target.insertFragment(fragment);
    expect(delta(target)).toEqual([
      { insert: 'Hello ' },
      { insert: 'world', attributes: { bold: true } },
      { insert: '@', attributes: { mention: ada } },
    ]);
  });

  it('drops values of unexpected types from pasted content', () => {
    const editor = makeEditor('hi ');
    const fragment = encodeFragment([
      { text: 'pwn', font_color: 1, bg_color: { x: 1 }, bold: true, mention: { person_id: 'no type' } },
    ]);

    editor.insertData(transfer({ 'text/html': `<span data-slate-fragment="${fragment}">pwn</span>` }));
    expect(delta(editor)).toEqual([{ insert: 'hi ' }, { insert: 'pwn', attributes: { bold: true } }]);
  });

  it('splits text that ended up inside a mention back out of it', () => {
    const mention = { type: 'person', person_id: 'u1', person_name: 'Ada' };
    const editor = makeEditor();

    editor.children = richTextToSlateValue([{ insert: '@later', attributes: { mention } }]);
    Editor.normalize(editor, { force: true });
    expect(delta(editor)).toEqual([{ insert: '@', attributes: { mention } }, { insert: 'later' }]);
  });

  describe('markdown typed right after a formatted run, a link or a chip', () => {
    const ada = { type: 'person', person_id: 'u1', person_name: 'Ada' };

    it.each([
      [
        '**a***b*',
        [],
        [
          { insert: 'a', attributes: { bold: true } },
          { insert: 'b', attributes: { italic: true } },
        ],
      ],
      [
        '`c`**b**',
        [],
        [
          { insert: 'c', attributes: { code: true } },
          { insert: 'b', attributes: { bold: true } },
        ],
      ],
      [
        '**Note**$$x$$',
        [],
        [
          { insert: 'Note', attributes: { bold: true } },
          { insert: '$', attributes: { formula: 'x' } },
        ],
      ],
      [
        '[a](https://a.io)**b**',
        [],
        [
          { insert: 'a', attributes: { href: 'https://a.io' } },
          { insert: 'b', attributes: { bold: true } },
        ],
      ],
      [
        '**b**',
        [{ insert: 'Hi ' }, { insert: '@', attributes: { mention: ada } }],
        [{ insert: 'Hi ' }, { insert: '@', attributes: { mention: ada } }, { insert: 'b', attributes: { bold: true } }],
      ],
      [
        '$$x$$',
        [{ insert: 'Hi ' }, { insert: '@', attributes: { mention: ada } }],
        [
          { insert: 'Hi ' },
          { insert: '@', attributes: { mention: ada } },
          { insert: '$', attributes: { formula: 'x' } },
        ],
      ],
    ])('formats the typed text of %s, not its neighbour', (typed, start, expected) => {
      const editor = makeEditor();

      editor.children = richTextToSlateValue(start as RichTextDelta);
      Transforms.select(editor, Editor.end(editor, []));
      typeText(editor, typed);
      expect(delta(editor)).toEqual(expected);
    });

    it('keeps the marks of the run the source was typed in', () => {
      const editor = makeEditor();

      editor.children = richTextToSlateValue([{ insert: 'Say ', attributes: { bold: true } }]);
      Transforms.select(editor, Editor.end(editor, []));
      typeText(editor, '*it*!');
      expect(delta(editor)).toEqual([
        { insert: 'Say ', attributes: { bold: true } },
        { insert: 'it', attributes: { bold: true, italic: true } },
        { insert: '!', attributes: { bold: true } },
      ]);
    });
  });

  it('turns [text](url) into a link', () => {
    const editor = makeEditor();

    typeText(editor, '[docs](https://docs.appflowy.io)');
    expect(delta(editor)).toEqual([{ insert: 'docs', attributes: { href: 'https://docs.appflowy.io' } }]);
  });

  it('leaves lone markers and block markdown alone', () => {
    const editor = makeEditor();

    typeText(editor, '2 * 3 = 6, # not a heading, - item, /todo');
    expect(delta(editor)).toEqual([{ insert: '2 * 3 = 6, # not a heading, - item, /todo' }]);
  });

  it('pastes multi-line plain text as lines', () => {
    const editor = makeEditor();

    editor.insertData(transfer({ 'text/plain': 'alpha\r\nbeta\ngamma' }));
    expect(delta(editor)).toEqual([{ insert: 'alpha\nbeta\ngamma' }]);
  });

  it('links selected text when a URL is pasted onto it', () => {
    const editor = makeEditor('AppFlowy site');

    Transforms.select(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 8 } });
    editor.insertData(transfer({ 'text/plain': 'https://appflowy.io' }));
    expect(delta(editor)).toEqual([
      { insert: 'AppFlowy', attributes: { href: 'https://appflowy.io' } },
      { insert: ' site' },
    ]);
  });

  it('pastes a bare URL as a link and keeps typing plain', () => {
    const editor = makeEditor('See ');

    editor.insertData(transfer({ 'text/plain': 'https://appflowy.io' }));
    typeText(editor, ' now');
    expect(delta(editor)).toEqual([
      { insert: 'See ' },
      { insert: 'https://appflowy.io', attributes: { href: 'https://appflowy.io' } },
      { insert: ' now' },
    ]);
  });

  it('pastes document blocks as lines that keep inline marks', () => {
    const editor = makeEditor();
    const fragment = [
      {
        type: 'heading',
        blockId: 'b1',
        children: [{ type: 'text', textId: 'b1', children: [{ text: 'Plan', bold: true }] }],
      },
      {
        type: 'bulleted_list',
        blockId: 'b2',
        children: [
          { type: 'text', textId: 'b2', children: [{ text: 'ship ' }, { text: 'it', italic: true }] },
          {
            type: 'paragraph',
            blockId: 'b3',
            children: [{ type: 'text', textId: 'b3', children: [{ text: 'nested' }] }],
          },
        ],
      },
    ];

    editor.insertData(transfer({ 'application/x-slate-fragment': encodeFragment(fragment), 'text/plain': 'Plan' }));
    expect(delta(editor)).toEqual([
      { insert: 'Plan', attributes: { bold: true } },
      { insert: '\nship ' },
      { insert: 'it', attributes: { italic: true } },
      { insert: '\nnested' },
    ]);
  });

  it('flattens an inline-only fragment onto one line', () => {
    const texts = flattenFragmentToTexts([{ text: 'a', bold: true }, { text: 'b' }] as Text[]);

    expect(texts).toEqual([{ text: 'a', bold: true }, { text: 'b' }]);
  });

  describe('single line (row title)', () => {
    it('ignores breaks', () => {
      const editor = makeEditor('Title', true);

      editor.insertBreak();
      editor.insertSoftBreak();
      expect(delta(editor)).toEqual([{ insert: 'Title' }]);
    });

    it('turns line breaks inside pasted or typed text into spaces', () => {
      const editor = makeEditor('', true);

      editor.insertText('one\ntwo');
      editor.insertFragment([
        { type: 'code', children: [{ type: 'text', children: [{ text: ' three\nfour' }] }] },
      ] as unknown as Node[]);
      expect(delta(editor)).toEqual([{ insert: 'one two three four' }]);
    });

    it('joins pasted lines and blocks with spaces', () => {
      const editor = makeEditor('', true);

      editor.insertData(transfer({ 'text/plain': 'alpha\nbeta' }));
      expect(delta(editor)).toEqual([{ insert: 'alpha beta' }]);

      const fragment = [
        { type: 'paragraph', children: [{ type: 'text', children: [{ text: 'one', bold: true }] }] },
        { type: 'paragraph', children: [{ type: 'text', children: [{ text: 'two' }] }] },
      ];

      editor.insertData(transfer({ 'application/x-slate-fragment': encodeFragment(fragment) }));
      expect(delta(editor)).toEqual([
        { insert: 'alpha beta' },
        { insert: 'one', attributes: { bold: true } },
        { insert: ' two' },
      ]);
    });
  });

  describe('equation shortcut', () => {
    function editorWith(delta: Parameters<typeof richTextToSlateValue>[0]) {
      const editor = makeEditor();

      editor.children = richTextToSlateValue(delta);
      Editor.normalize(editor, { force: true });
      return editor;
    }

    it('turns selected text into an equation', () => {
      const editor = editorWith([{ insert: 'Area a^2' }]);

      Transforms.select(editor, { anchor: { path: [0, 0], offset: 5 }, focus: { path: [0, 0], offset: 8 } });
      toggleEquation(editor);
      expect(delta(editor)).toEqual([{ insert: 'Area ' }, { insert: '$', attributes: { formula: 'a^2' } }]);
    });

    it('turns a selected equation back into its LaTeX', () => {
      const editor = editorWith([{ insert: 'Area ' }, { insert: '$', attributes: { formula: 'a^2' } }]);

      Transforms.select(editor, { anchor: { path: [0, 1], offset: 0 }, focus: { path: [0, 1], offset: 1 } });
      toggleEquation(editor);
      expect(delta(editor)).toEqual([{ insert: 'Area a^2' }]);
    });

    it('leaves a selection that holds a mention alone', () => {
      const mention = { type: 'person', person_id: 'u1', person_name: 'Ada' };
      const editor = editorWith([{ insert: 'ask ' }, { insert: '@', attributes: { mention } }, { insert: ' now' }]);

      Transforms.select(editor, Editor.range(editor, []));
      toggleEquation(editor);
      expect(delta(editor)).toEqual([{ insert: 'ask ' }, { insert: '@', attributes: { mention } }, { insert: ' now' }]);
    });
  });
});
