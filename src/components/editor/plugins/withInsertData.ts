import { Element, Node } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId, getBlockEntry, isInsideSimpleTableCell } from '@/application/slate-yjs/utils/editor';
import { BlockType, FieldURLType, FileBlockData, ImageBlockData, ImageType } from '@/application/types';
import { convertSlateFragmentTo } from '@/components/editor/utils/fragment';
import { FileHandler } from '@/utils/file';


export const withInsertData = (editor: ReactEditor) => {
  const { insertData } = editor;

  const e = editor as YjsEditor;

  editor.insertData = (data: DataTransfer) => {
    // When pasting inside a table cell, check if the fragment contains table blocks
    // and prevent nesting tables. Instead, extract text and fill adjacent cells.
    const tableCheckEntry = getBlockEntry(e);
    const tableCheckBlockId = tableCheckEntry ? (tableCheckEntry[0] as Element & { blockId?: string }).blockId : undefined;

    if (tableCheckBlockId && isInsideSimpleTableCell(e, tableCheckBlockId)) {
      // Check plain text for TSV (tab-separated values)
      const plainText = data.getData('text/plain')?.trim();

      if (plainText && plainText.includes('\t')) {
        // Delegate to insertTextData which has our TSV handler
        const handled = editor.insertTextData(data);

        if (handled) return;
      }

      // Check for Slate fragment containing table blocks
      const fragment = data.getData('application/x-slate-fragment');

      if (fragment) {
        try {
          const decoded = decodeURIComponent(window.atob(fragment));
          const parsed = JSON.parse(decoded) as Node[];

          // Check if fragment contains table blocks
          const hasTable = parsed.some((n: Node) =>
            Element.isElement(n) && [BlockType.SimpleTableBlock, BlockType.SimpleTableRowBlock, BlockType.SimpleTableCellBlock].includes(n.type as BlockType)
          );

          if (hasTable) {
            // Extract text from table cells and paste as TSV
            const texts = extractTextsFromFragment(parsed);

            if (texts) {
              const handled = editor.insertTextData(createTSVDataTransfer(texts));

              if (handled) return;
            }
          }
        } catch {
          // Fall through to default handling
        }
      }
    }

    const fragment = data.getData('application/x-slate-fragment');

    if (fragment) {
      const decoded = decodeURIComponent(window.atob(fragment));
      const parsed = JSON.parse(decoded) as Node[];
      const newFragment = convertSlateFragmentTo(parsed);

      return e.insertFragment(newFragment);
    }

    // Do something with the data...
    const fileArray = Array.from(data.files);
    const { selection } = editor;
    const entry = getBlockEntry(e);

    if (!entry) return;

    const [node] = entry;

    if (!node) return;

    const blockId = node.blockId;

    insertData(data);

    if (blockId && fileArray.length > 0 && selection) {
      void (async () => {
        const text = CustomEditor.getBlockTextContent(node);
        let newBlockId: string = blockId;

        for (const file of fileArray) {
          const url = await e.uploadFile?.(file);
          let fileId = '';

          if (!url) {
            const fileHandler = new FileHandler();
            const res = await fileHandler.handleFileUpload(file);

            fileId = res.id;
          }

          const isImage = file.type.startsWith('image/');

          if (isImage) {
            const data = {
              url: url,
              image_type: ImageType.External,
            } as ImageBlockData;

            if (fileId) {
              data.retry_local_url = fileId;
            }

            // Handle images...
            newBlockId = CustomEditor.addBelowBlock(e, newBlockId, BlockType.ImageBlock, data) || newBlockId;
          } else {
            const data = {
              url: url,
              name: file.name,
              uploaded_at: Date.now(),
              url_type: FieldURLType.Upload,
            } as FileBlockData;

            if (fileId) {
              data.retry_local_url = fileId;
            }

            // Handle files...
            newBlockId = CustomEditor.addBelowBlock(e, newBlockId, BlockType.FileBlock, data) || newBlockId;
          }

        }

        if (!text) {
          CustomEditor.deleteBlock(e, blockId);
        }

        const firstIsImage = fileArray[0].type.startsWith('image/');

        if (newBlockId && firstIsImage) {
          const id = CustomEditor.addBelowBlock(e, newBlockId, BlockType.Paragraph, {});

          if (!id) return;

          const entry = findSlateEntryByBlockId(e, id);

          if (!entry) return;

          const [, path] = entry;

          editor.select(editor.start(path));

        }

      })();

    }
  };

  return editor;
};

/**
 * Extract text content from a Slate fragment that contains table cells.
 * Returns a TSV string (tab-separated rows).
 */
function extractTextsFromFragment(nodes: Node[]): string | null {
  const rows: string[][] = [];

  for (const node of nodes) {
    if (Element.isElement(node)) {
      if (node.type === BlockType.SimpleTableBlock) {
        // Table > Row > Cell > Paragraph
        for (const row of (node.children || []) as Element[]) {
          const cellTexts: string[] = [];

          for (const cell of (row.children || []) as Element[]) {
            const text = Node.string(cell);

            cellTexts.push(text);
          }

          if (cellTexts.length > 0) {
            rows.push(cellTexts);
          }
        }
      } else if (node.type === BlockType.SimpleTableRowBlock) {
        const cellTexts: string[] = [];

        for (const cell of (node.children || []) as Element[]) {
          cellTexts.push(Node.string(cell));
        }

        if (cellTexts.length > 0) {
          rows.push(cellTexts);
        }
      } else if (node.type === BlockType.SimpleTableCellBlock) {
        rows.push([Node.string(node)]);
      } else {
        // Non-table content — just get text
        rows.push([Node.string(node)]);
      }
    }
  }

  if (rows.length === 0) return null;

  return rows.map(row => row.join('\t')).join('\n');
}

/**
 * Create a DataTransfer object with TSV text data.
 */
function createTSVDataTransfer(tsv: string): DataTransfer {
  const dt = new DataTransfer();

  dt.setData('text/plain', tsv);
  return dt;
}