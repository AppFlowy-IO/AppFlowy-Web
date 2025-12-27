import { BaseRange, NodeEntry, Point, Range, Text, Transforms } from 'slate';
import { TextInsertTextOptions } from 'slate/dist/interfaces/transforms/text';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { isEmbedBlockTypes } from '@/application/slate-yjs/command/const';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { Log } from '@/utils/log';

export const withInsertText = (editor: ReactEditor) => {
  const { insertText } = editor;

  editor.insertText = (text: string, options?: TextInsertTextOptions) => {
    const newAt = (options?.at || editor.selection) as BaseRange;

    if (!newAt || !Range.isCollapsed(newAt)) {
      insertText(text, options);
      return;
    }

    const point = newAt.anchor;

    const entry = getBlockEntry(editor as YjsEditor, point);

    if (!entry) return;

    const [blockNode] = entry;

    if (!blockNode) return;

    if (blockNode && isEmbedBlockTypes(blockNode.type as BlockType)) {
      return;
    }

    const [textEntry] = editor.nodes({
      at: point,
      match: (n) => {
        return Text.isText(n);
      },
    });

    if (!textEntry) {
      return;
    }

    const [textNode, textPath] = textEntry as NodeEntry<Text>;

    // If the text node is a formula or mention, split the node and insert the text
    if (textNode.formula || textNode.mention) {
      Log.debug('Inserting text into formula or mention', newAt);
      Transforms.insertNodes(editor, { text }, { at: point, select: true, voids: false });

      return;
    }

    const [start, end] = editor.edges(textPath);

    const inMiddle = Point.isAfter(point, start) && Point.isBefore(point, end);

    if (!inMiddle && (textNode.code || textNode.href)) {
      Transforms.insertNodes(editor, { text }, { at: point, select: true, voids: false });
      return;
    }

    insertText(text, options);
  };

  return editor;
};
