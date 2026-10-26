import { Editor, Element, Node, Path, Point, Range, Text, Transforms } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';

export type CodePlatform = 'mac' | 'windows' | 'linux';
export type CodeKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export function codeBoundary(text: string, offset: number, event: CodeKey, platform: CodePlatform): number | undefined {
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const start = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
  const next = text.indexOf('\n', offset);
  const end = next < 0 ? text.length : next;

  if (event.altKey) return;
  if (event.key === 'Home') return platform === 'mac' || event.ctrlKey ? 0 : offset === 0 ? 0 : start;
  if (event.key === 'End') return platform === 'mac' || event.ctrlKey ? text.length : end;
  if (!mod || platform === 'windows') return;
  if (event.key === 'ArrowLeft') return offset === 0 ? 0 : start;
  if (event.key === 'ArrowRight') return end;
  if (event.key === 'ArrowUp') return 0;
  if (event.key === 'ArrowDown') return text.length;
}

export function indentCodeLines(text: string, anchor: number, focus: number, outdent: boolean) {
  const start = Math.min(anchor, focus);
  const end = Math.max(anchor, focus);
  const first = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const edits: { at: number; remove: number; insert: string }[] = [];

  for (let at = first; at <= last; ) {
    const remove = outdent ? (text[at] === '\t' ? 1 : Math.min(2, /^ */.exec(text.slice(at))![0].length)) : 0;

    if (!outdent || remove) edits.push({ at, remove, insert: outdent ? '' : '  ' });
    const next = text.indexOf('\n', at);

    if (next < 0) break;
    at = next + 1;
  }

  const move = (offset: number) =>
    edits.reduce(
      (result, edit) =>
        edit.at <= offset ? result + edit.insert.length - Math.min(edit.remove, offset - edit.at) : result,
      offset
    );
  let result = text;

  for (const edit of [...edits].reverse())
    result = result.slice(0, edit.at) + edit.insert + result.slice(edit.at + edit.remove);
  return { text: result, anchor: move(anchor), focus: move(focus) };
}

export function pointAt(editor: Editor, path: Path, offset: number): Point {
  const node = Node.get(editor, path);
  let remaining = offset;

  for (const [text, relative] of Node.texts(node)) {
    if (remaining <= text.text.length) return { path: path.concat(relative), offset: remaining };
    remaining -= text.text.length;
  }

  return Editor.end(editor, path);
}

/** Prevent prose shortcuts from handling code; leave native caret/word movement to Slate. */
export function handleCodeKeyDown(editor: YjsEditor, event: KeyboardEvent, platform: CodePlatform): boolean {
  const { selection } = editor;

  if (!selection) return false;
  const entry = getBlockEntry(editor, selection.anchor);
  const endEntry = getBlockEntry(editor, selection.focus);

  if (!entry || entry[0].type !== BlockType.CodeBlock || entry[0] !== endEntry?.[0]) return false;
  if (event.isComposing || event.defaultPrevented) return true;
  const path = entry[1].concat(0);
  const text = Node.string(Node.get(editor, path));
  const offsetOf = (point: Point) => Editor.string(editor, { anchor: Editor.start(editor, path), focus: point }).length;
  const anchor = offsetOf(selection.anchor);
  const focus = offsetOf(selection.focus);
  const boundary = codeBoundary(text, focus, event, platform);

  if (boundary !== undefined) {
    event.preventDefault();
    const point = pointAt(editor, path, boundary);

    Transforms.select(editor, event.shiftKey ? { anchor: selection.anchor, focus: point } : point);
  } else if ((platform === 'mac' ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    Transforms.select(editor, Editor.range(editor, path));
  } else if (event.key === 'Tab') {
    event.preventDefault();
    if (Range.isCollapsed(selection) && !event.shiftKey) editor.insertText('  ');
    else {
      const result = indentCodeLines(text, anchor, focus, event.shiftKey);

      if (result.text !== text)
        Editor.withoutNormalizing(editor, () => {
          Transforms.insertText(editor, result.text, { at: Editor.range(editor, path) });
          Transforms.select(editor, {
            anchor: pointAt(editor, path, result.anchor),
            focus: pointAt(editor, path, result.focus),
          });
        });
    }
  } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (event.shiftKey) editor.insertBreak();
    else {
      const line = text.slice(0, Math.min(anchor, focus)).split('\n').pop() ?? '';
      const indentation = Range.isCollapsed(selection) ? /^\s*/.exec(line)![0] : '';

      editor.insertText(`\n${indentation}`);
    }
  }

  return true;
}

/** Selection formatting and inline panels must treat code as literal text. */
export function isCodeSelection(editor: Editor): boolean {
  if (!editor.selection) return false;
  for (const [node] of Editor.nodes(editor, {
    at: editor.selection,
    match: (node) =>
      (Element.isElement(node) && node.type === BlockType.CodeBlock) || (Text.isText(node) && !!node.code),
  })) {
    if (node) return true;
  }

  return false;
}
