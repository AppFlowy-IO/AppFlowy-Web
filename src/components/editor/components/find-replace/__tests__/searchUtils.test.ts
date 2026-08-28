import { createEditor, Descendant, Editor } from 'slate';

import { findMatches } from '../searchUtils';

/**
 * Build a minimal Slate editor whose document is `children`. findMatches only
 * traverses text leaves, so plain element/text nodes are enough here. We cast
 * through `unknown` because the test nodes intentionally omit the app's custom
 * Slate element fields (blockId, etc.) that findMatches never reads.
 */
function editorWith(children: unknown[]): Editor {
  const editor = createEditor();

  editor.children = children as Descendant[];
  return editor;
}

const paragraph = (texts: unknown[]) => ({ type: 'paragraph', children: texts });
const leaf = (text: string, extra: Record<string, unknown> = {}) => ({ text, ...extra });

describe('findMatches', () => {
  it('returns no matches for an empty query', () => {
    const editor = editorWith([paragraph([leaf('hello world')])]);

    expect(findMatches(editor, '', false)).toEqual([]);
  });

  it('finds a single match with correct anchor/focus offsets', () => {
    const editor = editorWith([paragraph([leaf('say hello')])]);

    const matches = findMatches(editor, 'hello', false);

    expect(matches).toHaveLength(1);
    expect(matches[0].anchor).toEqual({ path: [0, 0], offset: 4 });
    expect(matches[0].focus).toEqual({ path: [0, 0], offset: 9 });
  });

  it('finds multiple matches within one text node in ascending offset order', () => {
    const editor = editorWith([paragraph([leaf('hello world hello')])]);

    const matches = findMatches(editor, 'hello', false);

    expect(matches).toHaveLength(2);
    expect(matches[0].anchor.offset).toBe(0);
    expect(matches[0].focus.offset).toBe(5);
    expect(matches[1].anchor.offset).toBe(12);
    expect(matches[1].focus.offset).toBe(17);
  });

  it('finds matches across multiple blocks in document order', () => {
    const editor = editorWith([paragraph([leaf('foo bar')]), paragraph([leaf('bar foo')])]);

    const matches = findMatches(editor, 'foo', false);

    expect(matches).toHaveLength(2);
    expect(matches[0].anchor.path).toEqual([0, 0]);
    expect(matches[0].anchor.offset).toBe(0);
    expect(matches[1].anchor.path).toEqual([1, 0]);
    expect(matches[1].anchor.offset).toBe(4);
  });

  it('matches case-insensitively by default', () => {
    const editor = editorWith([paragraph([leaf('Hello hello HELLO')])]);

    expect(findMatches(editor, 'hello', false)).toHaveLength(3);
  });

  it('matches only the exact case when caseSensitive is true', () => {
    const editor = editorWith([paragraph([leaf('Hello hello HELLO')])]);

    const matches = findMatches(editor, 'hello', true);

    expect(matches).toHaveLength(1);
    expect(matches[0].anchor.offset).toBe(6);
  });

  it('returns non-overlapping matches for repeating patterns', () => {
    const editor = editorWith([paragraph([leaf('aaaa')])]);

    const matches = findMatches(editor, 'aa', false);

    expect(matches).toHaveLength(2);
    expect(matches[0].anchor.offset).toBe(0);
    expect(matches[1].anchor.offset).toBe(2);
  });

  it('returns an empty array when the query is absent', () => {
    const editor = editorWith([paragraph([leaf('hello world')])]);

    expect(findMatches(editor, 'zzz', false)).toEqual([]);
  });

  it('skips mention and formula leaves', () => {
    const editor = editorWith([
      paragraph([
        leaf('secret', { mention: { type: 'page', page_id: 'p1' } }),
        leaf('value', { formula: 'secret' }),
      ]),
    ]);

    expect(findMatches(editor, 'secret', false)).toEqual([]);
    expect(findMatches(editor, 'value', false)).toEqual([]);
  });

  it('ignores empty text nodes without throwing', () => {
    const editor = editorWith([paragraph([leaf('')]), paragraph([leaf('match')])]);

    const matches = findMatches(editor, 'match', false);

    expect(matches).toHaveLength(1);
    expect(matches[0].anchor.path).toEqual([1, 0]);
  });

  it('treats the query literally (no regex interpretation)', () => {
    const editor = editorWith([paragraph([leaf('a.b.c')])]);

    // "." should match literal dots only, at offsets 1 and 3.
    const dots = findMatches(editor, '.', false);

    expect(dots).toHaveLength(2);
    expect(dots.map((m) => m.anchor.offset)).toEqual([1, 3]);

    // A multi-char literal substring still works.
    expect(findMatches(editor, 'a.b', false)).toHaveLength(1);
  });

  it('produces in-bounds Slate offsets for characters whose lowercase expands (e.g. Turkish İ)', () => {
    // Original length 5 (5 UTF-16 code units); naive toLowerCase() yields a
    // 6-unit string, so a folded-offset implementation could overrun the node.
    const original = 'İello'; // U+0130 + 'ello'
    const editor = editorWith([paragraph([leaf(original)])]);

    const matches = findMatches(editor, 'İ', false);

    // Whatever the match length, the focus offset must never exceed the
    // original text node's length — otherwise Slate gets an invalid range.
    for (const m of matches) {
      expect(m.anchor.offset).toBeGreaterThanOrEqual(0);
      expect(m.focus.offset).toBeLessThanOrEqual(original.length);
      expect(m.focus.offset).toBeGreaterThan(m.anchor.offset);
    }
  });
});
