import { Editor, Element, Path, Range, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { TEXT_BLOCK_TYPES } from '@/application/slate-yjs/command/const';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType, MathEquationBlockData } from '@/application/types';

export const OPEN_MATH_EQUATION_EVENT = 'appflowy:open-math-equation';

/** Ignore adjacent leaves touched only by a selection's zero-width boundary. */
export function getSelectedEquationTexts(editor: Editor): Text[] {
  const { selection } = editor;

  if (!selection || Range.isCollapsed(selection)) return [];
  return Array.from(Editor.nodes<Text>(editor, { at: selection, match: Text.isText }))
    .filter(([, path]) => {
      const intersection = Range.intersection(selection, Editor.range(editor, path));

      return intersection && Range.isExpanded(intersection);
    })
    .map(([node]) => node);
}

export function insertInlineEquation(editor: Editor, formula: string, at = editor.selection): boolean {
  if (!at || !formula.trim() || !Editor.hasPath(editor, at.anchor.path) || !Editor.hasPath(editor, at.focus.path))
    return false;
  Editor.withoutNormalizing(editor, () => {
    Transforms.select(editor, at);
    if (Range.isExpanded(at)) Transforms.delete(editor);
    Transforms.insertNodes(editor, { text: '$', formula }, { select: true });
    Transforms.collapse(editor, { edge: 'end' });
    editor.removeMark('formula');
  });
  return true;
}

/** Shared by the selection toolbar and Mod+Shift+E. */
export function toggleInlineEquation(editor: ReactEditor): boolean {
  const { selection } = editor;

  if (!selection || Range.isCollapsed(selection) || (editor as YjsEditor).readOnly) return false;
  const entry = getBlockEntry(editor as YjsEditor);

  if (
    !entry ||
    !TEXT_BLOCK_TYPES.includes(entry[0].type as BlockType) ||
    entry[0].type === BlockType.CodeBlock ||
    editor.isElementReadOnly(entry[0])
  )
    return false;
  if (!Path.equals(Path.parent(selection.anchor.path), Path.parent(selection.focus.path))) return false;
  const texts = getSelectedEquationTexts(editor);

  if (texts.some((node) => node.mention || node.code)) return false;
  const formulas = texts.filter((node) => node.formula !== undefined);

  if (formulas.length) {
    if (formulas.length !== texts.length) return false;
    const source = formulas.map((node) => node.formula).join('');

    Editor.withoutNormalizing(editor, () => {
      Transforms.delete(editor);
      Transforms.insertNodes(editor, { text: source }, { select: true });
      Transforms.collapse(editor, { edge: 'end' });
      editor.removeMark('formula');
    });
    return true;
  }

  const inserted = insertInlineEquation(editor, Editor.string(editor, selection));
  const focus = editor.selection?.focus;

  // Formatting commands retain their selected range, like bold/italic. Slash
  // insertion and character shortcuts keep the caret after the equation.
  if (inserted && focus) editor.select({ anchor: { ...focus, offset: focus.offset - 1 }, focus });
  return inserted;
}

/** Called before the final dollar is inserted. Never scans through inline objects or code. */
export function applyMathShortcut(editor: YjsEditor): boolean {
  const { selection } = editor;

  if (!selection || !Range.isCollapsed(selection) || editor.readOnly || !Editor.hasPath(editor, selection.anchor.path))
    return false;
  const entry = getBlockEntry(editor);

  if (
    !entry ||
    !TEXT_BLOCK_TYPES.includes(entry[0].type as BlockType) ||
    entry[0].type === BlockType.CodeBlock ||
    editor.isElementReadOnly(entry[0])
  )
    return false;
  const [leaf] = Editor.node(editor, selection.anchor.path);

  if (!Text.isText(leaf) || leaf.formula !== undefined || leaf.mention || leaf.code) return false;
  const before = leaf.text.slice(0, selection.anchor.offset);
  const inTable = Boolean(
    Editor.above(editor, {
      at: selection,
      match: (node) => Element.isElement(node) && node.type === BlockType.SimpleTableCellBlock,
    })
  );

  if (!inTable && before === '$' && Editor.string(editor, entry[1]) === '$') {
    Transforms.insertText(editor, '$');
    editor.flushLocalChanges();
    const blockId = CustomEditor.turnToBlock(editor, entry[0].blockId as string, BlockType.EquationBlock, {
      formula: '',
    } as MathEquationBlockData);

    if (blockId) window.dispatchEvent(new CustomEvent(OPEN_MATH_EQUATION_EVENT, { detail: { editor, blockId } }));
    return true;
  }

  const block = before.endsWith('$');
  const closingStart = before.length - (block ? 1 : 0);
  const opening = before.slice(0, closingStart).lastIndexOf(block ? '$$' : '$');

  if (opening < 0 || (opening > 0 && /[$\\]/.test(before[opening - 1]))) return false;
  if (opening === 0) {
    const previous = Editor.before(editor, { path: selection.anchor.path, offset: 0 });

    if (previous) {
      const [previousLeaf] = Editor.node(editor, previous.path);

      if (Text.isText(previousLeaf) && previousLeaf.formula !== undefined) return false;
    }
  }

  const formula = before.slice(opening + (block ? 2 : 1), closingStart);

  if (!formula.trim() || formula.includes('\n') || formula.includes('$') || (block && inTable)) return false;
  const at = { anchor: { path: selection.anchor.path, offset: opening }, focus: selection.focus };

  if (!block) return insertInlineEquation(editor, formula, at);
  Transforms.delete(editor, { at });
  editor.flushLocalChanges();
  editor.insertBreak();
  editor.flushLocalChanges();
  const following = getBlockEntry(editor);

  if (!following) return false;
  const followingId = following[0].blockId as string;

  CustomEditor.addAboveBlock(editor, followingId, BlockType.EquationBlock, { formula } as MathEquationBlockData);
  const next = findSlateEntryByBlockId(editor, followingId);

  if (next) editor.select(editor.start(next[1]));
  return true;
}
