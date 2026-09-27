import { Descendant, Editor, Element, Node, Operation, Path, Point, Range, Text, Transforms } from 'slate';
import { History, HistoryEditor } from 'slate-history';

import { findFormulaPropCalls } from '@/application/database-yjs/fields/formula/prop-calls';

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
 * Complete `prop("...")` calls in formula source, read the way the formula
 * language and the draft rewrite read them ({@link findFormulaPropCalls}).
 * Pass the whole source: a string or comment can span lines, and a call inside
 * one is text. A reference after a dot (`current.prop("Status")`) reads
 * another database, so it stays text.
 */
export function findPropReferences(text: string): FormulaPropMatch[] {
  return findFormulaPropCalls(text).map(({ start, end, ref }) => ({ start, end, ref }));
}

/** Whether `source` is exactly one complete `prop("...")` call, i.e. a token's source. */
function isWholePropCall(source: string): boolean {
  const [match] = findPropReferences(source);

  return match !== undefined && match.start === 0 && match.end === source.length;
}

function propElement(source: string, ref: string): FormulaPropElement {
  return { type: FORMULA_PROP, source, ref, children: [{ text: '' }] };
}

/** A line's children: its text, with `matches` (offsets into the line) as tokens. */
function lineChildren(line: string, matches: FormulaPropMatch[]): Descendant[] {
  const children: Descendant[] = [];
  let cursor = 0;

  for (const match of matches) {
    children.push({ text: line.slice(cursor, match.start) });
    children.push(propElement(line.slice(match.start, match.end), match.ref) as unknown as Descendant);
    cursor = match.end;
  }

  children.push({ text: line.slice(cursor) });
  return children;
}

export function sourceToNodes(source: string): Descendant[] {
  // References are read off the whole source, since a string or comment can
  // span lines; a call split over lines stays text.
  const references = findPropReferences(source);
  let lineStart = 0;

  return source.split('\n').map((line) => {
    const start = lineStart;
    const end = start + line.length;
    const matches = references
      .filter((match) => match.start >= start && match.end <= end)
      .map((match) => ({ ...match, start: match.start - start, end: match.end - start }));

    lineStart = end + 1;
    return { type: FORMULA_LINE, children: lineChildren(line, matches) } as Descendant;
  });
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

/** The source range of the token at `path` (or holding it), or null when there is none. */
export function tokenRangeAt(editor: Editor, path: Path): { start: number; end: number } | null {
  if (!Node.has(editor, path)) return null;
  const entry = isFormulaProp(Node.get(editor, path))
    ? [Node.get(editor, path), path]
    : Editor.above(editor, { at: path, match: isFormulaProp, voids: true });

  if (!entry) return null;
  const token = entry[0] as unknown as FormulaPropElement;
  // A point inside a token sits after it.
  const end = pointToOffset(editor, Editor.start(editor, entry[1] as Path));

  return { start: end - token.source.length, end };
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

/**
 * Where `offset` in `before` falls in `after`: text the change left alone
 * keeps its place, and an offset inside the changed text goes after its
 * replacement.
 */
export function remapOffset(before: string, after: string, offset: number): number {
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;

  while (prefix < shorter && before[prefix] === after[prefix]) prefix += 1;
  if (offset <= prefix) return offset;
  let suffix = 0;

  while (suffix < shorter - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
    suffix += 1;
  }

  return after.length - Math.min(before.length - offset, suffix);
}

/** Rewrites one `prop("...")` call, e.g. to name a renamed property by its new name. */
export type PropSourceRebinder = (source: string) => string;

type HistoryBatch = History['undos'][number];

/**
 * `props` with its token source rewritten and its reference decoded again, or
 * the same object when nothing changed. A rewrite that is no longer one
 * complete call is ignored, so a token always stays a token.
 */
function rebindTokenProps<T extends object>(props: T, rebind: PropSourceRebinder): T {
  const { source } = props as { source?: unknown };

  if (typeof source !== 'string') return props;
  const next = rebind(source);

  if (next === source || !isWholePropCall(next)) return props;
  const [match] = findPropReferences(next);

  return { ...props, source: next, ...('ref' in props ? { ref: match.ref } : null) };
}

function rebindNode<T extends Node>(node: T, rebind: PropSourceRebinder): T {
  if (isFormulaProp(node)) return rebindTokenProps(node, rebind);
  if (!Element.isElement(node)) return node;
  let changed = false;
  const children = node.children.map((child) => {
    const next = rebindNode(child, rebind);

    changed ||= next !== child;
    return next;
  });

  return changed ? { ...node, children } : node;
}

/** Tokens travel in inserted and removed nodes, and as the properties of split, merged or set nodes. */
function rebindOperation(op: Operation, rebind: PropSourceRebinder): Operation {
  switch (op.type) {
    case 'insert_node':
    case 'remove_node': {
      const node = rebindNode(op.node, rebind);

      return node === op.node ? op : { ...op, node };
    }

    case 'split_node':
    case 'merge_node': {
      const properties = rebindTokenProps(op.properties, rebind);

      return properties === op.properties ? op : { ...op, properties };
    }

    case 'set_node': {
      const properties = rebindTokenProps(op.properties, rebind);
      const newProperties = rebindTokenProps(op.newProperties, rebind);

      return properties === op.properties && newProperties === op.newProperties
        ? op
        : { ...op, properties, newProperties };
    }

    default:
      return op;
  }
}

function rebindBatch(batch: HistoryBatch, rebind: PropSourceRebinder): HistoryBatch {
  const operations = batch.operations.map((op) => rebindOperation(op, rebind));

  return operations.every((op, index) => op === batch.operations[index]) ? batch : { ...batch, operations };
}

/**
 * Rewrites every token in the document and in its undo and redo history, so
 * an undo restores tokens written the same way as the document. Nothing else
 * moves: a token is a void with empty text, so no text offset, selection or
 * history path changes. Returns whether the document changed.
 */
export function rebindTokens(editor: Editor, rebind: PropSourceRebinder): boolean {
  const rebound = new Map<string, string>();
  const cachedRebind: PropSourceRebinder = (source) => {
    let next = rebound.get(source);

    if (next === undefined) {
      next = rebind(source);
      rebound.set(source, next);
    }

    return next;
  };

  const updates: Array<{ path: Path; source: string; ref: string }> = [];

  for (const [node, path] of Node.descendants(editor)) {
    if (!isFormulaProp(node)) continue;
    const next = rebindTokenProps(node, cachedRebind);

    if (next !== node) updates.push({ path, source: next.source, ref: next.ref });
  }

  const apply = () => {
    Editor.withoutNormalizing(editor, () => {
      updates.forEach(({ path, source, ref }) => {
        Transforms.setNodes(editor, { source, ref } as unknown as Partial<Element>, { at: path, voids: true });
      });
    });
  };

  if (HistoryEditor.isHistoryEditor(editor)) {
    editor.history = {
      undos: editor.history.undos.map((batch) => rebindBatch(batch, cachedRebind)),
      redos: editor.history.redos.map((batch) => rebindBatch(batch, cachedRebind)),
    };
    HistoryEditor.withoutSaving(editor, apply);
  } else {
    apply();
  }

  return updates.length > 0;
}

/**
 * The document's source with each `prop("...")` call that is still text
 * rewritten, e.g. one split over lines, which the formula reads as a call but
 * the editor never draws as a token; tokens are left as they are (see {@link
 * rebindTokens}). The document is not changed.
 */
export function rebindTextCalls(editor: Editor, rebind: PropSourceRebinder): string {
  const source = editorSource(editor);
  const tokens = new Set(tokenRanges(editor).map(({ start, end }) => `${start}:${end}`));
  let out = source;

  findPropReferences(source)
    .filter(({ start, end }) => !tokens.has(`${start}:${end}`))
    .reverse()
    .forEach(({ start, end }) => {
      const next = rebind(source.slice(start, end));

      // A rewrite that is no longer one complete call is ignored, as for tokens.
      if (isWholePropCall(next)) out = out.slice(0, start) + next + out.slice(end);
    });

  return out;
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

/** The source around the selection a paste replaces. */
export interface FormulaPasteContext {
  before: string;
  after: string;
}

/**
 * Clipboard type for what copied source's tokens name; other apps ignore it.
 * Its data is JSON: the `scope` it was copied in, the copied `text`, and
 * `[start, end, bound]` for each token in the text that {@link
 * FormulaTokenClipboard.bind} changed.
 */
export const FORMULA_CLIPBOARD_TYPE = 'application/x-appflowy-formula';

/**
 * Keeps copied tokens naming what they named when copied: a copy records
 * each token in a form that outlives renames (e.g. by property id), and a
 * paste in the same scope writes each one again for the properties as they
 * are now, the way the tokens in the editor are rewritten.
 */
export interface FormulaTokenClipboard {
  /** Where a copy's tokens can be read again, e.g. the database; undefined for nowhere. */
  scope: () => string | undefined;
  /** A token's `prop("...")` call → a form that outlives renames. */
  bind: (source: string) => string;
  /** That form → the token's `prop("...")` call now. */
  unbind: (bound: string) => string;
}

// Slate draws an empty text, like the ones on either side of a token, as a
// zero-width U+FEFF, so text taken off the editor's DOM holds them.
const ZERO_WIDTH = '\uFEFF';

/** The clipboard data recording the tokens in the selection, or undefined when there is nothing to record. */
function copiedTokens(editor: Editor, clipboard: FormulaTokenClipboard): string | undefined {
  const scope = clipboard.scope();
  const offsets = selectionOffsets(editor);

  if (!scope || !offsets) return;
  const source = editorSource(editor);
  const tokens: Array<[number, number, string]> = [];

  tokenRanges(editor).forEach(({ start, end }) => {
    if (start < offsets.start || end > offsets.end) return;
    const token = source.slice(start, end);
    const bound = clipboard.bind(token);

    if (bound !== token) tokens.push([start - offsets.start, end - offsets.start, bound]);
  });
  if (tokens.length === 0) return;
  return JSON.stringify({ scope, text: source.slice(offsets.start, offsets.end), tokens });
}

/**
 * `text` with each token its clipboard data records written for the current
 * properties, or undefined when the data is not from this scope or not about
 * `text`: then the text pastes as it is.
 */
function reboundPaste(text: string, data: string, clipboard: FormulaTokenClipboard): string | undefined {
  let copy: unknown;

  try {
    copy = JSON.parse(data);
  } catch {
    return;
  }

  const scope = clipboard.scope();
  const { scope: copyScope, text: copyText, tokens } = (copy ?? {}) as Record<string, unknown>;
  // The system clipboard can turn "\n" into "\r\n".
  const lines = text.replace(/\r\n?/g, '\n');

  if (!scope || copyScope !== scope || copyText !== lines || !Array.isArray(tokens)) return;
  let out = '';
  let cursor = 0;

  for (const token of tokens as unknown[]) {
    const [start, end, bound] = Array.isArray(token) ? token : [];

    if (!Number.isInteger(start) || !Number.isInteger(end) || typeof bound !== 'string') return;
    if (start < cursor || end <= start || end > lines.length || !isWholePropCall(lines.slice(start, end))) return;
    const next = clipboard.unbind(bound);

    out += lines.slice(cursor, start) + (isWholePropCall(next) ? next : lines.slice(start, end));
    cursor = end;
  }

  return out + lines.slice(cursor);
}

/**
 * Every reference in the source that lies inside one text node, i.e. a
 * complete `prop("...")` call that is not a token yet, with its offsets into
 * that text, last first. The source is read as a whole, so a call inside a
 * string or comment spanning lines is not one, and a call an edit on another
 * line (e.g. closing a string) turns from text into code is.
 */
function untokenizedReferences(editor: Editor): Array<{ path: Path; match: FormulaPropMatch }> {
  const references = findPropReferences(editorSource(editor));
  const found: Array<{ path: Path; match: FormulaPropMatch }> = [];

  if (references.length === 0) return found;
  let offset = 0;

  for (let lineIndex = 0; lineIndex < editor.children.length; lineIndex += 1) {
    const line = editor.children[lineIndex];

    if (lineIndex > 0) offset += 1;
    if (!isFormulaLine(line)) {
      offset += nodeSource(line).length;
      continue;
    }

    for (let childIndex = 0; childIndex < line.children.length; childIndex += 1) {
      const child = line.children[childIndex];
      const start = offset;
      const end = start + nodeSource(child).length;

      if (Text.isText(child)) {
        references
          .filter((reference) => reference.start >= start && reference.end <= end)
          .forEach((reference) => {
            found.push({
              path: [lineIndex, childIndex],
              match: { ...reference, start: reference.start - start, end: reference.end - start },
            });
          });
      }

      offset = end;
    }
  }

  // Inserting a token splits its text node, which leaves the paths and
  // offsets of everything before it as they were.
  return found.reverse();
}

/**
 * Makes tokens inline voids, turns every completed `prop("...")` in a text
 * node into a token (typed, pasted or inserted), keeps the document a list of
 * lines, and copies/pastes plain formula source.
 */
export function withFormulaTokens<T extends Editor>(
  editor: T,
  /**
   * Rewrites pasted text before it is inserted, e.g. bare property names into
   * prop("..."); `context` tells where it lands, e.g. inside a string.
   */
  preparePaste: (text: string, context: FormulaPasteContext) => string = (text) => text,
  /** Keeps copied tokens bound to what they named; without it they paste by name. */
  clipboard?: FormulaTokenClipboard
): T {
  const { insertText, isInline, isVoid, normalizeNode, shouldNormalize } = editor;
  // Tokens made in the current normalization run.
  let tokenized = 0;

  editor.isInline = (element) => element.type === FORMULA_PROP || isInline(element);
  editor.isVoid = (element) => element.type === FORMULA_PROP || isVoid(element);

  // Slate stops a normalization run after a number of steps set by how much
  // the edit dirtied, to catch normalizers that never settle. Making a token
  // dirties the nodes around it, so one pasted line holding many calls needs
  // more steps than its few dirty paths allow: each token made earns the steps
  // of one more dirty path.
  editor.shouldNormalize = (options) => {
    if (options.iteration === 0) tokenized = 0;
    return shouldNormalize({ ...options, initialDirtyPathsLength: options.initialDirtyPathsLength + tokenized });
  };

  editor.normalizeNode = (entry) => {
    const [node, path] = entry;

    if (path.length === 0 && editor.children.length === 0) {
      Transforms.insertNodes(editor, sourceToNodes(''), { at: [0] });
      return;
    }

    // Every edit dirties the whole document, and one can change how the
    // source around it reads (a quote typed on one line opens or closes a
    // string over the next), so references are found on the whole source.
    const unbound = path.length === 0 ? untokenizedReferences(editor) : [];

    // All of them in one step, so a pasted line is lexed once, not once per call.
    if (unbound.length > 0) {
      tokenized += unbound.length;
      const caret = editor.selection && Range.isCollapsed(editor.selection) ? editor.selection.anchor : null;
      const caretOffset = caret ? pointToOffset(editor, caret) : null;

      Editor.withoutNormalizing(editor, () => {
        unbound.forEach(({ path: textPath, match }) => {
          const text = (Node.get(editor, textPath) as Text).text;
          const at = { anchor: { path: textPath, offset: match.start }, focus: { path: textPath, offset: match.end } };

          // The text after the token gives the caret somewhere to land right away.
          Transforms.insertNodes(
            editor,
            [propElement(text.slice(match.start, match.end), match.ref) as unknown as Node, { text: '' }],
            { at }
          );
        });
      });
      // The source is unchanged, so the caret keeps its source offset.
      if (caretOffset !== null) Transforms.select(editor, offsetToPoint(editor, caretOffset));
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

    normalizeNode(entry);
  };

  // Copies, cuts and drags carry only the formula source. A drag starts with
  // the browser's HTML of the selection, which shows tokens by name.
  editor.setFragmentData = (data) => {
    const text = selectedSource(editor);
    const tokens = clipboard && copiedTokens(editor, clipboard);

    if (typeof data.clearData === 'function') data.clearData();
    data.setData('text/plain', text);
    if (tokens) data.setData(FORMULA_CLIPBOARD_TYPE, tokens);
  };

  // Reads `text` as pasted where the selection is.
  const insertPasted = (text: string) => {
    // The paste replaces the selection once its edges are outside tokens.
    selectOutsideTokens(editor);
    const source = editorSource(editor);
    const { start, end } = selectionOffsets(editor) ?? { start: source.length, end: source.length };

    insertSource(editor, preparePaste(text, { before: source.slice(0, start), after: source.slice(end) }));
  };

  // Only plain text is pasted, its tokens named as they are now when a copy
  // here recorded them; an empty paste still replaces the selection.
  editor.insertData = (data) => {
    if (!Array.from(data.types ?? []).includes('text/plain') && !data.getData('text/plain')) return;
    const text = data.getData('text/plain');
    const tokens = clipboard ? data.getData(FORMULA_CLIPBOARD_TYPE) : '';
    const rebound = clipboard && tokens ? reboundPaste(text, tokens, clipboard) : undefined;

    insertPasted(rebound ?? text);
  };

  // Typed-in text holding a zero-width U+FEFF was taken off the editor's DOM,
  // e.g. by the macOS kill ring that Ctrl+K fills and Ctrl+Y yanks back. It
  // shows tokens by name, so read it the way a paste is read, which turns the
  // names back into tokens.
  editor.insertText = (text, options) => {
    if (!text.includes(ZERO_WIDTH) || options?.at || !editor.selection) {
      insertText(text, options);
      return;
    }

    insertPasted(text.split(ZERO_WIDTH).join(''));
  };

  return editor;
}
