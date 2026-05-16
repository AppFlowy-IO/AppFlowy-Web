import { Editor, Element, Node, Range, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { findSlateEntryByBlockId, getBlockEntry, getSharedRoot, isInsideSimpleTableCell } from '@/application/slate-yjs/utils/editor';
import { assertDocExists, getBlock, getChildrenArray } from '@/application/slate-yjs/utils/yjs';
import { BlockType, FieldURLType, FileBlockData, ImageBlockData, ImageType, YjsEditorKey } from '@/application/types';
import { convertSlateFragmentTo } from '@/components/editor/utils/fragment';
import { FileHandler } from '@/utils/file';
import { Log } from '@/utils/log';

type BlockElement = Element & { blockId?: string };


export const withInsertData = (editor: ReactEditor) => {
  const { insertData } = editor;

  const e = editor as YjsEditor;

  editor.insertData = (data: DataTransfer) => {
    // When pasting inside a table cell, check if the fragment contains table blocks
    // and prevent nesting tables. Instead, extract text and fill adjacent cells.
    const tableCheckEntry = getBlockEntry(e);
    const tableCheckBlockId = tableCheckEntry ? (tableCheckEntry[0] as BlockElement).blockId : undefined;

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

    const rawFragment =
      data.getData('application/x-slate-fragment') ||
      extractSlateFragmentFromHTML(data.getData('text/html'));

    if (rawFragment) {
      const parsed = decodeSlateFragment(rawFragment);

      if (parsed) {
        const newFragment = convertSlateFragmentTo(parsed);

        // Slate's default insertFragment nests pasted blocks under the current
        // block when the cursor sits deep inside a text wrapper. Use the YJS
        // insertion path instead so the pasted blocks become siblings of the
        // current block at the same indent level.
        if (insertFragmentAsSiblings(e, newFragment)) return;

        return e.insertFragment(newFragment);
      }
      // Malformed fragment data — fall through to other handlers.
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
        const pendingUploads: Promise<void>[] = [];

        // One handler for the whole batch — each `new FileHandler()` opens
        // its own IDB connection promise, so reusing avoids that overhead.
        const fileHandler = new FileHandler();

        // Best-effort: a missing local snapshot must not block the remote
        // upload (IndexedDB may be unavailable in private mode or over
        // quota). Persist every snapshot in parallel so paste latency
        // scales with the slowest IDB write, not the sum.
        const fileIds = await Promise.all(
          fileArray.map(async (file) => {
            try {
              const res = await fileHandler.handleFileUpload(file);

              // Paste path never renders the local preview itself — the
              // block creates its own object URL via `getStoredFile`.
              // Revoke the one created here so it doesn't leak until the
              // tab unloads.
              URL.revokeObjectURL(res.url);
              return res.id;
            } catch (err) {
              Log.warn('withInsertData: failed to persist local snapshot for pasted file', err);
              return '';
            }
          })
        );

        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          const fileId = fileIds[i];
          const isImage = file.type.startsWith('image/');
          let insertedBlockId: string | undefined;

          if (isImage) {
            const data = {
              url: '',
              image_type: undefined,
              retry_local_url: fileId,
            } as ImageBlockData;

            insertedBlockId = CustomEditor.addBelowBlock(e, newBlockId, BlockType.ImageBlock, data);
            newBlockId = insertedBlockId || newBlockId;
          } else {
            const data = {
              url: '',
              name: file.name,
              uploaded_at: Date.now(),
              url_type: FieldURLType.Upload,
              retry_local_url: fileId,
            } as FileBlockData;

            insertedBlockId = CustomEditor.addBelowBlock(e, newBlockId, BlockType.FileBlock, data);
            newBlockId = insertedBlockId || newBlockId;
          }

          if (insertedBlockId) {
            pendingUploads.push((async () => {
              let url: string | undefined;

              try {
                url = await e.uploadFile?.(file);
              } catch {
                return;
              }

              if (!url) return;

              if (fileId) {
                await fileHandler.cleanup(fileId).catch(() => undefined);
              }

              // The paste handler runs in the background after the user
              // already moved on. Skip the write if the placeholder is gone
              // or already finalised so we don't clobber later edits.
              let currentData: { url?: string; retry_local_url?: string } | undefined;

              try {
                const entry = findSlateEntryByBlockId(e, insertedBlockId);

                currentData = entry ? ((entry[0] as { data?: { url?: string; retry_local_url?: string } }).data ?? undefined) : undefined;
              } catch {
                return;
              }

              if (!currentData) return;
              if (currentData.url) return;
              if ((currentData.retry_local_url ?? '') !== fileId) return;

              if (isImage) {
                CustomEditor.setBlockData(e, insertedBlockId, {
                  url,
                  image_type: ImageType.External,
                  retry_local_url: '',
                } as ImageBlockData);
              } else {
                CustomEditor.setBlockData(e, insertedBlockId, {
                  url,
                  name: file.name,
                  uploaded_at: Date.now(),
                  url_type: FieldURLType.Upload,
                  retry_local_url: '',
                } as FileBlockData);
              }
            })());
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

        void Promise.all(pendingUploads).catch((err) => {
          Log.warn('withInsertData: failed to finalize pasted file upload', err);
        });
      })();

    }
  };

  return editor;
};

/**
 * When Slate copies content, it encodes the full Slate fragment as a base64
 * blob in the `data-slate-fragment` HTML attribute. The system clipboard
 * often drops the `application/x-slate-fragment` MIME entry, so we recover
 * the fragment from the HTML attribute when available.
 *
 * Uses the same regex shape as `slate-dom`'s `getSlateFragmentAttribute`.
 */
function extractSlateFragmentFromHTML(html: string | undefined): string | undefined {
  if (!html) return undefined;

  const match = html.match(/data-slate-fragment="(.+?)"/m);

  return match ? match[1] : undefined;
}

/**
 * Decode the base64+URI-encoded JSON Slate fragment. Returns `null` for
 * malformed input so the caller can fall back gracefully instead of throwing
 * out of the paste handler.
 */
function decodeSlateFragment(raw: string): Node[] | null {
  try {
    return JSON.parse(decodeURIComponent(window.atob(raw))) as Node[];
  } catch (err) {
    Log.warn('decodeSlateFragment: malformed clipboard fragment', err);
    return null;
  }
}

/**
 * Inserts a Slate fragment as siblings of the current block using the YJS
 * shared doc, mirroring the path used by `insertParsedBlocks` for HTML paste.
 *
 * Returns true if the fragment was inserted; false if the caller should fall
 * back to Slate's default `insertFragment`.
 *
 * Mirrors two behaviors of Slate's `Transforms.insertFragment`:
 *  - If the selection is expanded, delete the selected range first.
 *  - After insertion, place the cursor at the end of the last inserted block.
 */
function insertFragmentAsSiblings(editor: YjsEditor, fragment: Node[]): boolean {
  if (fragment.length === 0) return false;

  try {
    // Every fragment node must be a block-level element with a text wrapper
    // child — anything else (loose text, inline-only fragments) goes through
    // Slate's default path so inline pastes still work.
    const allBlocks = fragment.every((n) => {
      if (!Element.isElement(n)) return false;
      const children = n.children;

      return (
        Array.isArray(children) &&
        children.length > 0 &&
        Element.isElement(children[0]) &&
        children[0].type === YjsEditorKey.text
      );
    });

    if (!allBlocks) return false;

    // Match Slate's default `Transforms.insertFragment`: collapse expanded
    // selection by deleting the selected range first. Re-fetch the block
    // entry afterward because the deletion changes which block holds the
    // cursor and whether it is empty.
    if (editor.selection && !Range.isCollapsed(editor.selection)) {
      Transforms.delete(editor);
    }

    const entry = getBlockEntry(editor);

    if (!entry) return false;

    const [node] = entry;
    const blockId = (node as BlockElement).blockId;

    if (!blockId) return false;

    const sharedRoot = getSharedRoot(editor);
    const block = getBlock(blockId, sharedRoot);

    if (!block) return false;

    const parentId = block.get(YjsEditorKey.block_parent);
    const parent = getBlock(parentId, sharedRoot);

    if (!parent) return false;

    const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);
    const index = parentChildren.toArray().findIndex((id) => id === blockId);

    if (index < 0) return false;

    // If the current block is empty (no text, no children), the user expects
    // paste to fill that block — not push it above the pasted content. Insert
    // at the current index and remove the empty original.
    const isEmpty =
      CustomEditor.getBlockTextContent(node as Node).length === 0 &&
      (node.children?.length ?? 0) <= 1;

    const doc = assertDocExists(sharedRoot);
    let insertedIds: string[] = [];

    doc.transact(() => {
      if (isEmpty) {
        insertedIds = slateContentInsertToYData(parentId, index, fragment, doc);
        CustomEditor.deleteBlock(editor, blockId);
      } else {
        insertedIds = slateContentInsertToYData(parentId, index + 1, fragment, doc);
      }
    });

    // Place the cursor at the end of the last inserted block so subsequent
    // edits target a valid location (not the now-deleted original block).
    const lastId = insertedIds[insertedIds.length - 1];

    if (lastId) {
      const lastEntry = findSlateEntryByBlockId(editor, lastId);

      if (lastEntry) {
        const [, path] = lastEntry;

        try {
          Transforms.select(editor, Editor.end(editor, path));
        } catch (err) {
          // Editor.end can throw if the path was rebuilt mid-transact; the
          // selection will be re-derived on the next user keystroke.
          Log.warn('insertFragmentAsSiblings: could not set selection', err);
        }
      }
    }

    return true;
  } catch (err) {
    Log.error('insertFragmentAsSiblings failed', err);
    return false;
  }
}

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
