import { createEditor, Element, Node } from 'slate';
import { withReact } from 'slate-react';

import { withYjs } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { withInsertData } from '@/components/editor/plugins/withInsertData';

const block = (type: BlockType, text: string, data = {}): Element =>
  ({ type, data, children: [{ type: YjsEditorKey.text, children: [{ text }] }] } as Element);

// Flutter document_copy_and_paste_test: a copied selection beginning with an
// image must remain sibling blocks, rather than being merged into paragraph text.
it.each(['application/x-appflowy-fragment', 'application/x-slate-fragment', 'text/html'])(
  'pastes an image-first selection from %s, preserving data, order and undo',
  (format) => {
    const doc = withTestingYDoc('image-page');
    const imageData = { url: 'https://example.com/photo.png', name: 'photo.png', caption: 'Caption', width: 320 };
    const source = [block(BlockType.ImageBlock, '', imageData), block(BlockType.Paragraph, 'Hello World')];

    slateContentInsertToYData('image-page', 0, source, doc);
    const editor = withInsertData(
      withReact(withYHistory(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local })))
    ) as ReturnType<typeof withYHistory>;

    editor.connect();
    try {
      editor.select({ path: [1, 0, 0], offset: 11 });
      const encoded = window.btoa(encodeURIComponent(JSON.stringify(source)));

      editor.insertData({
        files: [],
        getData: (type: string) =>
          type === format
            ? format === 'text/html'
              ? `<span data-slate-fragment="${encoded}">image</span>`
              : encoded
            : '',
      } as unknown as DataTransfer);
      editor.flushLocalChanges();
      expect(editor.children.map((node) => (node as Element).type)).toEqual([
        BlockType.ImageBlock,
        BlockType.Paragraph,
        BlockType.ImageBlock,
        BlockType.Paragraph,
      ]);
      expect(editor.children.map(Node.string)).toEqual(['', 'Hello World', '', 'Hello World']);
      expect(editor.children[2]).toMatchObject({ data: imageData });
      expect((editor.children[2] as Element).blockId).not.toBe((editor.children[0] as Element).blockId);
      expect(yDocToSlateContent(doc)?.children).toEqual(editor.children);
      editor.undo();
      expect(editor.children).toHaveLength(2);
      editor.redo();
      expect(editor.children).toHaveLength(4);
      expect(editor.children[2]).toMatchObject({ data: imageData });
    } finally {
      editor.disconnect();
      doc.destroy();
    }
  }
);
