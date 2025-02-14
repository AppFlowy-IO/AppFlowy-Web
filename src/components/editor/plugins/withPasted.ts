import { YjsEditor } from '@/application/slate-yjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import {
  beforePasted,
  findSlateEntryByBlockId,
  getBlockEntry,
  getSharedRoot,
} from '@/application/slate-yjs/utils/editor';
import { BlockType, LinkPreviewBlockData, MentionType, YjsEditorKey } from '@/application/types';
import { deserializeHTML } from '@/components/editor/utils/fragment';
import { BasePoint, Node, Transforms, Text, Element } from 'slate';
import { ReactEditor } from 'slate-react';
import isURL from 'validator/lib/isURL';
import { assertDocExists, deleteBlock, getBlock, getChildrenArray } from '@/application/slate-yjs/utils/yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { processUrl } from '@/utils/url';

export const withPasted = (editor: ReactEditor) => {
  editor.insertTextData = (data: DataTransfer) => {
    if (!beforePasted(editor)) return false;
    const text = data.getData('text/plain');

    if (text) {
      const lines = text.split(/\r\n|\r|\n/);

      const html = data.getData('text/html');
      const lineLength = lines.length;

      const point = editor.selection?.anchor as BasePoint;
      const [node] = getBlockEntry(editor as YjsEditor, point);

      if (lineLength === 1) {
        const isUrl = !!processUrl(text);

        if (isUrl) {
          const isAppFlowyLinkUrl = isURL(text, {
            host_whitelist: [window.location.hostname],
          });

          if (isAppFlowyLinkUrl) {
            const url = new URL(text);
            const blockId = url.searchParams.get('blockId');

            if (blockId) {
              const pageId = url.pathname.split('/').pop();
              const point = editor.selection?.anchor as BasePoint;

              Transforms.insertNodes(
                editor,
                {
                  text: '@',
                  mention: {
                    type: MentionType.PageRef,
                    page_id: pageId,
                    block_id: blockId,
                  },
                },
                { at: point, select: true, voids: false }
              );

              return true;
            }
          }

          // const currentBlockId = node.blockId as string;
          //
          // CustomEditor.addBelowBlock(editor as YjsEditor, currentBlockId, BlockType.LinkPreview, { url: text } as LinkPreviewBlockData);
          insertFragment(editor, [
            {
              type: BlockType.LinkPreview,
              data: { url: text } as LinkPreviewBlockData,
              children: [{ text: '' }],
            },
          ]);

          return true;
        }
      }

      if (lineLength > 1 && node.type !== BlockType.CodeBlock) {
        if (html) {
          return insertHtmlData(editor, data);
        }
        // else {
        //   const fragment = lines.map((line) => ({ type: BlockType.Paragraph, children: [{ text: line }] }));

        //   insertFragment(editor, fragment);
        //   return true;
        // }
      }

      for (const index in lines) {
        const point = editor.selection?.anchor as BasePoint;

        Transforms.insertNodes(
          editor,
          { text: `${lines[index]}${parseInt(index) < lineLength - 1 ? `\n` : ''}` },
          {
            at: point,
            select: true,
            voids: false,
          }
        );
      }

      return true;
    }

    return false;
  };

  editor.insertFragment = (fragment, options = {}) => {
    return insertFragment(editor, fragment, options);
  };

  return editor;
};

export function insertHtmlData(editor: ReactEditor, data: DataTransfer) {
  const html = data.getData('text/html');

  if (html) {
    console.log('insert HTML Data', html);
    const fragment = deserializeHTML(html) as Node[];

    insertFragment(editor, fragment);

    return true;
  }

  return false;
}

function insertFragment(editor: ReactEditor, fragment: Node[], options = {}) {
  console.log('insertFragment', fragment, options);
  if (!beforePasted(editor)) return;

  const point = editor.selection?.anchor as BasePoint;
  const [node] = getBlockEntry(editor as YjsEditor, point);
  const blockId = node.blockId as string;
  const sharedRoot = getSharedRoot(editor as YjsEditor);
  const isEmptyNode = CustomEditor.getBlockTextContent(node) === '';
  const block = getBlock(blockId, sharedRoot);
  const parent = getBlock(block.get(YjsEditorKey.block_parent), sharedRoot);
  const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);
  const index = parentChildren.toArray().findIndex((id) => id === block.get(YjsEditorKey.block_id));
  const doc = assertDocExists(sharedRoot);

  if (fragment.length === 1) {
    const firstNode = fragment[0] as Element;

    const findTextNodes = (node: Node): Node[] => {
      if (Text.isText(node)) {
        return [];
      }

      if (Element.isElement(node) && node.textId) {
        return [node];
      }

      return node.children.flatMap(findTextNodes);
    };

    const textNodes = findTextNodes(firstNode);

    if (textNodes.length === 1) {
      const textNode = textNodes[0] as Element;
      const texts = textNode.children.filter((node) => Text.isText(node));

      Transforms.insertNodes(editor, texts, { at: point, select: true, voids: false });
      return;
    }
  }

  let lastBlockId = blockId;

  doc.transact(() => {
    const newBlockIds = slateContentInsertToYData(block.get(YjsEditorKey.block_parent), index + 1, fragment, doc);

    lastBlockId = newBlockIds[newBlockIds.length - 1];
    if (isEmptyNode) {
      deleteBlock(sharedRoot, blockId);
    }
  });

  setTimeout(() => {
    const [, path] = findSlateEntryByBlockId(editor as YjsEditor, lastBlockId);

    const point = editor.end(path);

    editor.select(point);
  }, 50);

  return;
}
