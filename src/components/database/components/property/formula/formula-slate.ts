import { Descendant, Editor, Element, Node, Point, Range, Text, Transforms } from 'slate';
import { HistoryEditor } from 'slate-history';

import { tokenize } from '@/application/database-yjs/fields/formula/lexer';

/**
 * The formula editor is a small Slate document: one `formula-line` element per
 * source line, holding text and `formula-prop` tokens. A token is an inline
 * void that stands for a complete `prop("...")` call; it keeps that call's
 * exact source, so the document always serializes back to the formula text.
 *
 * Offsets below are positions in that serialized source. A token counts as
 * its source length and no caret can sit inside it.
 */

export const FORMULA_LINE = 'formula-line';
export const FORMULA_PROP = 'formula-prop';

export interface FormulaPropElement {
  type: typeof FORMULA_PROP;
  /** The `prop("...")` call as written. */
  source: string;
  /** The decoded argument: a property name or id. */
  ref: string;
  children: [{ text: '' }];
}

export interface FormulaPropMatch {
  start: number;
  end: number;
  ref: string;
}

export function isFormulaProp(node: unknown): node is FormulaPropElement {
  return Element.isElement(node) && node.type === FORMULA_PROP;
}

function isFormulaLine(node: unknown): node is Element {
  return Element.isElement(node) && node.type === FORMULA_LINE;
}

/**
 * Complete `prop("...")` calls in one line of source. A reference after a dot
 * (`current.prop("Status")`) reads another database, so it stays text.
 */
export function findPropReferences(text: string): FormulaPropMatch[] {
  if (!text.includes('prop')) return [];
  let tokens;

  try {
    tokens = tokenize(text, true);
  } catch {
    return [];
  }

  const matches: FormulaPropMatch[] = [];

  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const [ident, open, ref, close] = tokens.slice(index, index + 4);
    const previous = tokens[index - 1];

    if (
      ident.kind === 'ident' &&
      ident.value === 'prop' &&
      open.kind === 'punct' &&
      open.value === '(' &&
      ref.kind === 'string' &&
      close.kind === 'punct' &&
      close.value === ')' &&
      !(previous?.kind === 'punct' && previous.value === '.')
    ) {
      matches.push({ start: ident.position.offset, end: close.end, ref: ref.value });
      index += 3;
    }
  }

  return matches;
}

function propElement(source: string, ref: string): FormulaPropElement {
  return { type: FORMULA_PROP, source, ref, children: [{ text: '' }] };
}

function lineChildren(line: string): Descendant[] {
  const children: Descendant[] = [];
  let cursor = 0;

  for (const match of findPropReferences(line)) {
    children.push({ text: line.slice(cursor, match.start) });
    children.push(propElement(line.slice(match.start, match.end), match.ref) as unknown as Descendant);
    cursor = match.end;
  }

  children.push({ text: line.slice(cursor) });
  return children;
}

export function sourceToNodes(source: string): Descendant[] {
  return source.split('\n').map((line) => ({ type: FORMULA_LINE, children: lineChildren(line) } as Descendant));
}

function nodeSource(node: Node): string {
  if (Text.isText(node)) return node.text;
  if (isFormulaProp(node)) return node.source;
  return (node as Element).children.map(nodeSource).join('');
}

export function nodesToSource(nodes: Descendant[]): string {
  return nodes.map(nodeSource).join('\n');
}

export function editorSource(editor: Editor): string {
  return nodesToSource(editor.children);
}

/** Where `point` falls in the serialized source. */
export function pointToOffset(editor: Editor, point: Point): number {
  const [lineIndex, childIndex] = point.path;
  let offset = 0;

  editor.children.forEach((line, index) => {
    if (index < lineIndex) offset += nodeSource(line).length + 1;
  });

  const line = editor.children[lineIndex] as Element | undefined;

  line?.children.forEach((child, index) => {
    if (index < childIndex) offset += nodeSource(child).length;
  });

  // A point inside a token (its empty text) sits after the token.
  const child = line?.children[childIndex];

  if (isFormulaProp(child)) return offset + child.source.length;
  return offset + point.offset;
}

/** The text point for a source offset; offsets inside a token snap to its end. */
export function offsetToPoint(editor: Editor, target: number): Point {
  let remaining = Math.max(0, target);

  for (let lineIndex = 0; lineIndex < editor.children.length; lineIndex += 1) {
    const line = editor.children[lineIndex] as Element;
    const length = nodeSource(line).length;
    const isLast = lineIndex === editor.children.length - 1;

    if (remaining > length && !isLast) {
      remaining -= length + 1;
      continue;
    }

    for (let childIndex = 0; childIndex < line.children.length; childIndex += 1) {
      const child = line.children[childIndex];

      if (Text.isText(child)) {
        if (remaining <= child.text.length) return { path: [lineIndex, childIndex], offset: remaining };
        remaining -= child.text.length;
        continue;
      }

      const size = nodeSource(child).length;

      remaining = Math.max(0, remaining - size);
    }

    return Editor.end(editor, [lineIndex]);
  }

  return Editor.end(editor, []);
}

export function selectionOffsets(editor: Editor): { start: number; end: number } | null {
  const { selection } = editor;

  if (!selection) return null;
  const [start, end] = Range.edges(selection);

  return { start: pointToOffset(editor, start), end: pointToOffset(editor, end) };
}

/** Source ranges covered by tokens. */
export function tokenRanges(editor: Editor): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;

  editor.children.forEach((line, lineIndex) => {
    if (lineIndex > 0) offset += 1;
    (line as Element).children.forEach((child) => {
      const size = nodeSource(child).length;

      if (isFormulaProp(child)) ranges.push({ start: offset, end: offset + size });
      offset += size;
    });
  });

  return ranges;
}

/**
 * Moves the caret one character, stepping over a whole token. With `extend`
 * only the selection's focus moves (Shift+Arrow). Returns false when there is
 * nowhere to go, so the caller can fall back.
 */
export function moveCaret(editor: Editor, reverse: boolean, extend = false): boolean {
  const { selection } = editor;

  if (!selection) return false;
  const focus = pointToOffset(editor, selection.focus);
  let target: number;

  if (!extend && !Range.isCollapsed(selection)) {
    // Like a text field: an arrow collapses the selection to that side.
    const [start, end] = Range.edges(selection);

    target = pointToOffset(editor, reverse ? start : end);
  } else {
    target = focus + (reverse ? -1 : 1);
    const token = tokenRanges(editor).find((range) => target > range.start && target < range.end);

    if (token) target = reverse ? token.start : token.end;
  }

  if (target < 0 || target > editorSource(editor).length) return false;
  const point = offsetToPoint(editor, target);

  Transforms.select(editor, extend ? { anchor: selection.anchor, focus: point } : point);
  return true;
}

/** A caret that landed inside a token (e.g. by a click) moves after it. */
export function ejectCaretFromToken(editor: Editor): void {
  const { selection } = editor;

  if (!selection || !Range.isCollapsed(selection)) return;
  const [token] = Editor.nodes(editor, { at: selection, match: isFormulaProp });

  if (token) Transforms.select(editor, offsetToPoint(editor, pointToOffset(editor, selection.anchor)));
}

/**
 * Moves selection edges that sit inside a token out of it: a caret goes after
 * the token, a range grows to cover it. Slate ignores text inserted into a
 * void, and Chrome can hand a paste a target range inside a token's spacer.
 */
function selectOutsideTokens(editor: Editor) {
  const { selection } = editor;

  if (!selection) return;
  const inToken = (point: Point) => Editor.above(editor, { at: point, match: isFormulaProp });

  if (!inToken(selection.anchor) && !inToken(selection.focus)) return;
  if (Range.isCollapsed(selection)) {
    Transforms.select(editor, offsetToPoint(editor, pointToOffset(editor, selection.anchor)));
    return;
  }

  const [start, end] = Range.edges(selection);
  const startToken = inToken(start);
  const startOffset = startToken
    ? pointToOffset(editor, start) - (startToken[0] as unknown as FormulaPropElement).source.length
    : pointToOffset(editor, start);

  Transforms.select(editor, {
    anchor: offsetToPoint(editor, startOffset),
    focus: offsetToPoint(editor, pointToOffset(editor, end)),
  });
}

/** Inserts plain source at the selection; new lines split the line. */
export function insertSource(editor: Editor, text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  selectOutsideTokens(editor);
  Editor.withoutNormalizing(editor, () => {
    if (editor.selection && !Range.isCollapsed(editor.selection)) Transforms.delete(editor);
    lines.forEach((line, index) => {
      if (index > 0) Transforms.splitNodes(editor, { always: true });
      if (line) Transforms.insertText(editor, line);
    });
  });
}

/** Replaces `[start, end)` of the source with `text` and puts the caret `caretOffset` into it. */
export function replaceSourceRange(editor: Editor, start: number, end: number, text: string, caretOffset: number) {
  Transforms.select(editor, { anchor: offsetToPoint(editor, start), focus: offsetToPoint(editor, end) });
  insertSource(editor, text);
  Transforms.select(editor, offsetToPoint(editor, start + caretOffset));
}

/** Replaces the whole document; used when the formula changes from outside. */
export function resetSource(editor: Editor, source: string, caret?: number) {
  const apply = () => {
    Editor.withoutNormalizing(editor, () => {
      for (let index = editor.children.length - 1; index >= 0; index -= 1) {
        Transforms.removeNodes(editor, { at: [index] });
      }

      Transforms.insertNodes(editor, sourceToNodes(source), { at: [0] });
    });
    Transforms.select(editor, offsetToPoint(editor, caret ?? source.length));
  };

  // A new formula from outside starts a fresh undo history.
  if (HistoryEditor.isHistoryEditor(editor)) {
    HistoryEditor.withoutSaving(editor, apply);
    editor.history = { undos: [], redos: [] };
  } else {
    apply();
  }
}

/** Source offset of every text node, keyed by path, for syntax decorations. */
export function textOffsets(nodes: Descendant[]): Map<string, number> {
  const offsets = new Map<string, number>();
  let offset = 0;

  nodes.forEach((line, lineIndex) => {
    if (lineIndex > 0) offset += 1;
    (line as Element).children.forEach((child, childIndex) => {
      if (Text.isText(child)) offsets.set(`${lineIndex}.${childIndex}`, offset);
      offset += nodeSource(child).length;
    });
  });

  return offsets;
}

/** Selected source; tokens copy out as their `prop("...")` call. */
export function selectedSource(editor: Editor): string {
  const offsets = selectionOffsets(editor);

  if (!offsets) return '';
  return editorSource(editor).slice(offsets.start, offsets.end);
}

/**
 * Makes tokens inline voids, turns every completed `prop("...")` in a text
 * node into a token (typed, pasted or inserted), keeps the document a list of
 * lines, and copies/pastes plain formula source.
 */
export function withFormulaTokens<T extends Editor>(
  editor: T,
  /** Rewrites pasted text before it is inserted, e.g. bare property names into prop("..."). */
  preparePaste: (text: string) => string = (text) => text
): T {
  const { isInline, isVoid, normalizeNode } = editor;

  editor.isInline = (element) => element.type === FORMULA_PROP || isInline(element);
  editor.isVoid = (element) => element.type === FORMULA_PROP || isVoid(element);

  editor.normalizeNode = (entry) => {
    const [node, path] = entry;

    if (path.length === 0 && editor.children.length === 0) {
      Transforms.insertNodes(editor, sourceToNodes(''), { at: [0] });
      return;
    }

    // Lines hold only text and tokens; anything else is flattened into text.
    if (path.length === 1 && !isFormulaLine(node)) {
      if (Text.isText(node)) {
        Transforms.wrapNodes(editor, { type: FORMULA_LINE, children: [] } as unknown as Element, { at: path });
      } else {
        Transforms.setNodes(editor, { type: FORMULA_LINE } as Partial<Element>, { at: path });
      }

      return;
    }

    if (path.length === 2 && Element.isElement(node) && !isFormulaProp(node)) {
      Transforms.unwrapNodes(editor, { at: path });
      return;
    }

    if (Text.isText(node) && path.length === 2) {
      const [match] = findPropReferences(node.text);

      if (match) {
        const at = { anchor: { path, offset: match.start }, focus: { path, offset: match.end } };
        const source = node.text.slice(match.start, match.end);
        const caret = editor.selection && Range.isCollapsed(editor.selection) ? editor.selection.anchor : null;
        const caretOffset = caret ? pointToOffset(editor, caret) : null;

        // The text after the token gives the caret somewhere to land right away.
        Transforms.insertNodes(editor, [propElement(source, match.ref) as unknown as Node, { text: '' }], { at });
        // The source is unchanged, so the caret keeps its source offset.
        if (caretOffset !== null) Transforms.select(editor, offsetToPoint(editor, caretOffset));
        return;
      }
    }

    normalizeNode(entry);
  };

  editor.setFragmentData = (data) => {
    const text = selectedSource(editor);

    data.setData('text/plain', text);
  };

  // Only plain text is pasted; an empty paste still replaces the selection.
  editor.insertData = (data) => {
    if (Array.from(data.types ?? []).includes('text/plain') || data.getData('text/plain')) {
      insertSource(editor, preparePaste(data.getData('text/plain')));
    }
  };

  return editor;
}
