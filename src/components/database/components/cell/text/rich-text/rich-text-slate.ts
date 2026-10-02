import { Descendant, Editor, Element, Node, Path, Range, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import { type RichTextDelta, sanitizeRichTextAttributes } from '@/application/database-yjs/fields/text/rich-text';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { extractAppFlowyClipboardFragment } from '@/components/editor/clipboard/appflowy-fragment';
import { isSingleURLText, processUrl } from '@/utils/url';

/**
 * Slate model for a Text cell: one paragraph of marked text, with line breaks
 * kept as `\n` inside it (a property holds inline content only, like Notion's
 * Text property: no lists, headings or other blocks).
 */

export const RICH_TEXT_CELL_ELEMENT = 'paragraph';

/** The marks a Text cell keeps, in the shape it reads them; see `sanitizeRichTextAttributes`. */
function pickMarks(source: Record<string, unknown>) {
  return sanitizeRichTextAttributes(source);
}

/** Marks that turn a text run into one inline object (a chip). */
const ATOMIC_MARKS = [EditorMarkFormat.Mention, EditorMarkFormat.Formula] as const;

/** The characters a mention or an equation sits on: `@` (web) and `$` (Desktop). */
const ATOM_PLACEHOLDERS = new Set(['@', '$']);

/**
 * Each mention or equation node carries a key of its own, never saved (it is
 * not a mark the cell keeps): Slate merges equal neighbouring text nodes, and
 * the key keeps two identical chips side by side (the same person twice) two
 * chips.
 */
const ATOM_KEY = 'atom_key';

let atomKeySeq = 0;

function nextAtomKey() {
  atomKeySeq += 1;
  return `atom-${atomKeySeq}`;
}

function isAtomic(text: Text) {
  return ATOMIC_MARKS.some((mark) => Boolean(text[mark]));
}

/**
 * The marks of a run (or of the caret) minus what makes a chip: the marks
 * text typed next to a chip takes.
 */
function textMarks(source: object | null): Omit<Text, 'text'> {
  const marks: Record<string, unknown> = { ...source };

  delete marks.text;
  ATOMIC_MARKS.forEach((mark) => delete marks[mark]);
  delete marks[ATOM_KEY];
  return marks as Omit<Text, 'text'>;
}

function hasAtomMarks(marks: object) {
  return ATOMIC_MARKS.some((mark) => mark in marks) || ATOM_KEY in marks;
}

/**
 * How a run carrying a mention or an equation reads, as on Desktop: every
 * placeholder character is one chip, and any other character in it (e.g.
 * text typed into a chip by an older draft) is plain text.
 */
function splitAtomText(text: string) {
  const parts: { text: string; atom: boolean }[] = [];

  for (const char of text) {
    const atom = ATOM_PLACEHOLDERS.has(char);
    const last = parts[parts.length - 1];

    if (!atom && last && !last.atom) {
      last.text += char;
    } else {
      parts.push({ text: char, atom });
    }
  }

  return parts;
}

export function richTextToSlateValue(delta: RichTextDelta): Descendant[] {
  const children: Text[] = delta
    .filter(({ insert }) => insert.length > 0)
    .flatMap(({ insert, attributes }) => {
      const marks = pickMarks(attributes ?? {});

      if (!ATOMIC_MARKS.some((mark) => mark in marks)) return [{ ...marks, text: insert } as Text];

      return splitAtomText(insert).map(({ text, atom }) =>
        atom ? ({ ...marks, [ATOM_KEY]: nextAtomKey(), text } as Text) : { ...textMarks(marks), text }
      );
    });

  return [
    {
      type: RICH_TEXT_CELL_ELEMENT,
      children: children.length > 0 ? children : [{ text: '' }],
    },
  ];
}

export function slateValueToRichText(nodes: Descendant[]): RichTextDelta {
  const delta: RichTextDelta = [];

  nodes.forEach((node, index) => {
    if (index > 0) delta.push({ insert: '\n' });

    for (const [text] of Node.texts(node)) {
      if (!text.text) continue;
      const { text: insert, ...rest } = text;
      const attributes = pickMarks(rest as Record<string, unknown>);
      const last = delta[delta.length - 1];

      // Adjacent runs with the same marks are one insert, as in a Y.Text delta.
      // Mentions and equations stay separate: each placeholder character is
      // its own inline object.
      if (
        last &&
        !attributes.mention &&
        !attributes.formula &&
        JSON.stringify(last.attributes ?? {}) === JSON.stringify(attributes)
      ) {
        last.insert += insert;
        continue;
      }

      delta.push(Object.keys(attributes).length > 0 ? { insert, attributes } : { insert });
    }
  });

  return delta;
}

/**
 * Collapses any pasted fragment (document blocks, lists, tables) into the
 * text runs of a single paragraph: each block becomes one line, and the
 * inline marks the cell supports survive.
 */
export function flattenFragmentToTexts(fragment: Node[], lineBreak = '\n'): Text[] {
  const lines: Text[][] = [];

  const visit = (node: Node) => {
    if (Text.isText(node)) {
      lines.push([node]);
      return;
    }

    if (!Element.isElement(node)) return;

    const ownTexts = node.children.filter((child) => Text.isText(child)) as Text[];

    if (ownTexts.length > 0) {
      lines.push(ownTexts);
    }

    node.children.forEach((child) => {
      if (Element.isElement(child)) visit(child);
    });
  };

  // Loose top-level texts (an inline-only copy) stay on one line.
  if (fragment.every((node) => Text.isText(node))) {
    lines.push(fragment as Text[]);
  } else {
    fragment.forEach(visit);
  }

  const result: Text[] = [];

  lines
    .filter((line) => line.some((text) => text.text.length > 0))
    .forEach((line, index) => {
      if (index > 0) result.push({ text: lineBreak });
      line.forEach((text) => {
        const { text: value, ...rest } = text;

        result.push({
          ...pickMarks(rest as Record<string, unknown>),
          text: lineBreak === '\n' ? value : value.replace(/\r\n?|\n/g, lineBreak),
        } as Text);
      });
    });

  return result;
}

/**
 * Copying from a Text cell (its editor or its read-only display) puts the
 * selected runs on the clipboard in the document's block shape, a paragraph
 * wrapping a text element, so a document pastes them with their formatting.
 * Slate's own shape (runs right under the paragraph) pastes into a document
 * as an empty paragraph. A cell reads either shape back.
 */
export function withRichTextCellCopy<T extends Editor>(editor: T): T {
  editor.getFragment = () => {
    const { selection } = editor;

    if (!selection) return [];

    const texts = flattenFragmentToTexts(Node.fragment(editor, selection));

    return [
      {
        type: RICH_TEXT_CELL_ELEMENT,
        data: {},
        children: [{ type: 'text', children: texts.length > 0 ? texts : [{ text: '' }] }],
      },
    ];
  };

  return editor;
}

function decodeSlateFragment(raw: string): Node[] | null {
  try {
    return JSON.parse(decodeURIComponent(window.atob(raw))) as Node[];
  } catch {
    return null;
  }
}

function readClipboardFragment(data: DataTransfer): Node[] | null {
  const appflowy = extractAppFlowyClipboardFragment(data);

  if (appflowy) return appflowy.fragment;

  const html = data.getData('text/html');
  const raw = data.getData('application/x-slate-fragment') || html?.match(/data-slate-fragment="(.+?)"/m)?.[1];

  return raw ? decodeSlateFragment(raw) : null;
}

function insertTexts(editor: Editor, texts: Text[]) {
  if (texts.length === 0) return;

  if (editor.selection && Range.isExpanded(editor.selection)) {
    Transforms.delete(editor);
  }

  Transforms.insertNodes(editor, texts, { select: true });
}

function insertLink(editor: Editor, url: string) {
  const href = processUrl(url) || url;

  if (editor.selection && Range.isExpanded(editor.selection)) {
    // Pasting a link onto selected text links that text, as in Notion.
    editor.addMark(EditorMarkFormat.Href, href);
    Transforms.collapse(editor, { edge: 'end' });
    return;
  }

  Transforms.insertNodes(editor, [{ text: url, href } as Text], { select: true });
  // Typing after the pasted link continues as plain text.
  editor.removeMark(EditorMarkFormat.Href);
}

type InlineMarkdownRule = {
  match: RegExp;
  /** The text the matched source turns into, and the marks it gets. */
  convert: (match: RegExpMatchArray) => { text: string; marks: Record<string, unknown> };
};

function markRule(match: RegExp, format: EditorMarkFormat): InlineMarkdownRule {
  return { match, convert: ([, content]) => ({ text: content, marks: { [format]: true } }) };
}

// Each rule matches text that ends at the caret once the closing character
// is typed. Double-character rules come first so `**` is not read as `*`.
// As in Markdown, the content starts and ends with a non-space character and
// single-character delimiters do not open inside a word, so "2*3*4" and
// "~5 to ~10 days" stay text. Inline equations take `$$…$$` only (as in
// Notion): a single `$` is far more often a price than LaTeX.
const INLINE_MARKDOWN_RULES: InlineMarkdownRule[] = [
  markRule(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, EditorMarkFormat.Bold),
  markRule(/(?<![_\w])__([^_\s](?:[^_]*[^_\s])?)__$/, EditorMarkFormat.Bold),
  markRule(/(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, EditorMarkFormat.Italic),
  markRule(/(?<![_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, EditorMarkFormat.Italic),
  markRule(/~~([^~\s](?:[^~]*[^~\s])?)~~$/, EditorMarkFormat.StrikeThrough),
  markRule(/(?<![~\w])~([^~\s](?:[^~]*[^~\s])?)~$/, EditorMarkFormat.StrikeThrough),
  markRule(/`([^`]+)`$/, EditorMarkFormat.Code),
  {
    match: /\$\$([^$]+)\$\$$/,
    convert: ([, latex]) => ({ text: '$', marks: { [EditorMarkFormat.Formula]: latex } }),
  },
  {
    match: /\[([^\]]+)\]\(([^)\s]+)\)$/,
    convert: ([, content, url]) => ({ text: content, marks: { [EditorMarkFormat.Href]: processUrl(url) || url } }),
  },
];

const INLINE_MARKDOWN_TRIGGERS = new Set(['*', '_', '~', '`', '$', ')']);

function applyInlineMarkdown(editor: Editor, typed: string) {
  const { selection } = editor;

  if (!selection || !Range.isCollapsed(selection)) return false;

  const [node] = Editor.node(editor, selection.anchor.path);

  // Never re-format inside code, a link, a mention or an equation.
  if (!Text.isText(node) || node.code || node.href || node.mention || node.formula) return false;

  const before = node.text.slice(0, selection.anchor.offset) + typed;

  for (const rule of INLINE_MARKDOWN_RULES) {
    const result = before.match(rule.match);

    if (!result || result.index === undefined) continue;

    const { text: content, marks } = rule.convert(result);
    // The converted text keeps the marks of the run it was typed in.
    const runMarks = textMarks(node);

    // Remove the typed source (minus the character being typed now). When
    // that was the whole run, the run goes and the caret moves to its
    // neighbour, so the result goes in as a node of its own.
    Transforms.delete(editor, {
      at: {
        anchor: { path: selection.anchor.path, offset: result.index },
        focus: selection.anchor,
      },
    });
    Transforms.insertNodes(editor, { ...runMarks, ...marks, text: content } as Text, { select: true });
    // Typing on continues in the run's own format.
    editor.marks = runMarks;
    return true;
  }

  return false;
}

/**
 * Cmd/Ctrl+Shift+E, with the equation button's rules: an equation turns back
 * into its LaTeX; a selection that holds a mention or equation is left alone;
 * other selected text becomes an equation.
 */
export function toggleEquation(editor: Editor) {
  const { selection } = editor;

  if (!selection || Range.isCollapsed(selection)) return;

  const atomic = Array.from(
    Editor.nodes(editor, { at: selection, match: (n) => Text.isText(n) && Boolean(n.formula || n.mention) })
  );
  const [only] = atomic;

  if (atomic.length === 1 && Text.isText(only[0]) && only[0].formula && Editor.string(editor, selection) === only[0].text) {
    const latex = only[0].formula;

    Transforms.select(editor, only[1]);
    Transforms.delete(editor);
    Transforms.insertText(editor, latex);
    return;
  }

  if (atomic.length > 0) return;

  const latex = Editor.string(editor, selection);

  Transforms.delete(editor);
  // Text typed after it goes into a run of its own (see `insertText`).
  Transforms.insertNodes(editor, [{ text: '$', formula: latex }], { select: true });
}

function atomKeyOf(text: Text) {
  return (text as Text & { [ATOM_KEY]?: string })[ATOM_KEY];
}

/**
 * Keeps every mention or equation one keyed placeholder character
 * ({@link splitAtomText}, {@link ATOM_KEY}). Returns whether it changed the
 * node, which is then normalized again.
 */
function normalizeAtomText(editor: Editor, node: Text, path: Path) {
  if (!isAtomic(node)) {
    // A key outlives its chip when the chip's mark is removed.
    if (atomKeyOf(node) === undefined) return false;
    Transforms.unsetNodes(editor, ATOM_KEY, { at: path });
    return true;
  }

  const parts = splitAtomText(node.text);

  if (parts.length === 1 && parts[0].atom) {
    if (atomKeyOf(node)) return false;
    Transforms.setNodes(editor, { [ATOM_KEY]: nextAtomKey() } as Partial<Text>, { at: path });
    return true;
  }

  // An emptied chip is plain (empty) text.
  if (parts.length === 0) {
    Transforms.unsetNodes(editor, [...ATOMIC_MARKS, ATOM_KEY], { at: path });
    return true;
  }

  // Several placeholders (equal chips Slate merged, or a stored run of them)
  // or text inside a chip: one keyed node per placeholder, the rest plain.
  Editor.withoutNormalizing(editor, () => {
    const offsets: number[] = [];
    let offset = 0;

    parts.forEach(({ text }) => {
      offsets.push(offset);
      offset += text.length;
    });

    // Split from the end, so `path` keeps pointing at the first part.
    offsets
      .slice(1)
      .reverse()
      .forEach((at) => Transforms.splitNodes(editor, { at: { path, offset: at }, match: Text.isText }));

    const parent = Path.parent(path);
    const first = path[path.length - 1];

    parts.forEach(({ atom }, index) => {
      const at = [...parent, first + index];

      if (atom) {
        Transforms.setNodes(editor, { [ATOM_KEY]: nextAtomKey() } as Partial<Text>, { at });
      } else {
        Transforms.unsetNodes(editor, [...ATOMIC_MARKS, ATOM_KEY], { at });
      }
    });
  });
  return true;
}

export interface RichTextCellOptions {
  /** A title: no line breaks; pasted lines are joined with spaces. */
  singleLine?: boolean;
}

/**
 * Plugin for the Text cell editor: keeps the document to one paragraph,
 * turns Enter-style breaks into soft line breaks, applies inline markdown
 * shortcuts, keeps mentions and equations one character each, and pastes
 * rich AppFlowy fragments as inline text.
 */
export function withRichTextCell<T extends ReactEditor>(editor: T, { singleLine = false }: RichTextCellOptions = {}): T {
  const { insertText, normalizeNode } = editor;
  const lineBreak = singleLine ? ' ' : '\n';

  withRichTextCellCopy(editor);

  editor.insertBreak = () => {
    if (!singleLine) editor.insertText('\n');
  };

  editor.insertSoftBreak = () => {
    if (!singleLine) editor.insertText('\n');
  };

  editor.insertText = (text, options) => {
    const value = singleLine ? text.replace(/\r\n?|\n/g, ' ') : text;

    if (!value) return;

    if (value.length === 1 && INLINE_MARKDOWN_TRIGGERS.has(value) && applyInlineMarkdown(editor, value)) {
      return;
    }

    Editor.withoutNormalizing(editor, () => {
      // Typing over a selection replaces it first, so text typed over a
      // selected chip does not land inside the chip.
      if (editor.selection && Range.isExpanded(editor.selection)) {
        Transforms.delete(editor);
      }

      const { selection } = editor;

      if (!selection) return;

      const marks = Editor.marks(editor);
      const [node] = Editor.leaf(editor, selection.anchor);

      // A mention or an equation is one placeholder character: text typed at
      // either edge of it (or into a chip just emptied) must not extend it,
      // or it would be lost from `data`. It goes into a run of its own.
      if (isAtomic(node)) {
        Transforms.insertNodes(editor, { ...textMarks(marks), text: value } as Text, {
          at: selection.anchor,
          select: true,
        });
        editor.marks = null;
        return;
      }

      // Right after a chip the caret reads the chip's marks.
      if (marks && hasAtomMarks(marks)) editor.marks = textMarks(marks);
      insertText(value, options);
    });
  };

  editor.insertFragment = (fragment) => {
    insertTexts(editor, flattenFragmentToTexts(fragment, lineBreak));
  };

  editor.insertData = (data) => {
    const fragment = readClipboardFragment(data);

    if (fragment) {
      insertTexts(editor, flattenFragmentToTexts(fragment, lineBreak));
      return;
    }

    const plain = data.getData('text/plain');

    if (!plain) return;

    if (isSingleURLText(plain)) {
      insertLink(editor, plain.trim());
      return;
    }

    editor.insertText(plain.replace(/\r\n?|\n/g, lineBreak));
  };

  editor.normalizeNode = (entry) => {
    const [node, path] = entry;

    // Merge any extra top-level blocks into the first, one line each.
    if (path.length === 0 && editor.children.length > 1) {
      Editor.withoutNormalizing(editor, () => {
        while (editor.children.length > 1) {
          const end = Editor.end(editor, [0]);

          Transforms.insertText(editor, lineBreak, { at: end });
          Transforms.mergeNodes(editor, { at: [1] });
        }
      });
      return;
    }

    if (Text.isText(node) && normalizeAtomText(editor, node, path)) return;

    if (Element.isElement(node) && path.length === 1 && node.type !== RICH_TEXT_CELL_ELEMENT) {
      Transforms.setNodes(editor, { type: RICH_TEXT_CELL_ELEMENT }, { at: path });
      return;
    }

    normalizeNode(entry);
  };

  return editor;
}
