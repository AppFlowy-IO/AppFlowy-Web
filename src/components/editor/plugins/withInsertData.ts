import { Element, Node } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { TEXT_BLOCK_TYPES } from '@/application/slate-yjs/command/const';
import { findSlateEntryByBlockId, getBlockEntry, isInsideSimpleTableCell } from '@/application/slate-yjs/utils/editor';
import {
  BlockType,
  FieldURLType,
  FileBlockData,
  ImageBlockData,
  ImageType,
  YjsEditorKey,
} from '@/application/types';
import { extractAppFlowyClipboardFragment } from '@/components/editor/clipboard/appflowy-fragment';
import { stripInlineCommentIds } from '@/components/editor/clipboard/inline-comment-metadata';
import { containsSimpleTableBlocks, extractTSVFromTableFragment } from '@/components/editor/clipboard/table-fragment';
import { convertSlateFragmentTo } from '@/components/editor/utils/fragment';
import { insertBlocksAtCaret } from '@/components/editor/utils/insert-blocks-at-caret';
import { FileHandler } from '@/utils/file';
import { Log } from '@/utils/log';
import { createPendingUploadId } from '@/utils/pending-upload';
import { isSingleURLText } from '@/utils/url';

type BlockElement = Element & { blockId?: string };

export const withInsertData = (editor: ReactEditor) => {
  const { insertData } = editor;

  const e = editor as YjsEditor;

  editor.insertData = (data: DataTransfer) => {
    const richFragment = extractAppFlowyClipboardFragment(data);

    // When pasting inside a table cell, check if the fragment contains table blocks
    // and prevent nesting tables. Instead, extract text and fill adjacent cells.
    const tableCheckEntry = getBlockEntry(e);
    const tableCheckBlockId = tableCheckEntry ? (tableCheckEntry[0] as BlockElement).blockId : undefined;

    if (tableCheckBlockId && isInsideSimpleTableCell(e, tableCheckBlockId)) {
      // Check plain text for TSV (tab-separated values)
      const plainText = data.getData('text/plain')?.trim();
      const singleURLText = getSingleURLTextFromClipboard(data);

      if (plainText && plainText.includes('\t')) {
        // Delegate to insertTextData which has our TSV handler
        const handled = editor.insertTextData(data);

        if (handled) return;
      }

      if (singleURLText) {
        const handled = editor.insertTextData(createTextDataTransfer(singleURLText, data.getData('text/html')));

        if (handled) return;
      }

      // Check for Slate fragment containing table blocks
      const fragment = data.getData('application/x-slate-fragment');
      const parsedFragment = richFragment?.fragment;

      if (fragment) {
        try {
          const decoded = decodeURIComponent(window.atob(fragment));
          const parsed = JSON.parse(decoded) as Node[];

          if (containsSimpleTableBlocks(parsed)) {
            // Extract text from table cells and paste as TSV
            const texts = extractTSVFromTableFragment(parsed);

            if (texts) {
              const handled = editor.insertTextData(createTextDataTransfer(texts));

              if (handled) return;
            }
          }
        } catch {
          // Fall through to default handling
        }
      }

      if (parsedFragment && containsSimpleTableBlocks(parsedFragment)) {
        const texts = extractTSVFromTableFragment(parsedFragment);

        if (texts) {
          const handled = editor.insertTextData(createTextDataTransfer(texts));

          if (handled) return;
        }
      }
    }

    if (richFragment) {
      const newFragment = convertSlateFragmentTo(stripInlineCommentIds(richFragment.fragment));

      if (insertFragmentAsSiblings(e, newFragment)) return;

      return e.insertFragment(newFragment);
    }

    const rawFragment =
      data.getData('application/x-slate-fragment') || extractSlateFragmentFromHTML(data.getData('text/html'));

    if (rawFragment) {
      const parsed = decodeSlateFragment(rawFragment);

      if (parsed) {
        const newFragment = convertSlateFragmentTo(stripInlineCommentIds(parsed));

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
          const pendingUploadId = createPendingUploadId();
          const isImage = file.type.startsWith('image/');
          let insertedBlockId: string | undefined;

          if (isImage) {
            const data = {
              url: '',
              image_type: undefined,
              retry_local_url: fileId,
              pending_upload_id: pendingUploadId,
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
              pending_upload_id: pendingUploadId,
            } as FileBlockData;

            insertedBlockId = CustomEditor.addBelowBlock(e, newBlockId, BlockType.FileBlock, data);
            newBlockId = insertedBlockId || newBlockId;
          }

          if (insertedBlockId) {
            pendingUploads.push(
              (async () => {
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
                let currentData: { url?: string; pending_upload_id?: string } | undefined;

                try {
                  const entry = findSlateEntryByBlockId(e, insertedBlockId);

                  currentData = entry
                    ? (entry[0] as { data?: { url?: string; pending_upload_id?: string } }).data ?? undefined
                    : undefined;
                } catch {
                  return;
                }

                if (!currentData) return;
                if (currentData.url) return;
                if (currentData.pending_upload_id !== pendingUploadId) return;

                if (isImage) {
                  CustomEditor.setBlockData(e, insertedBlockId, {
                    url,
                    image_type: ImageType.External,
                    retry_local_url: '',
                    pending_upload_id: '',
                  } as ImageBlockData);
                } else {
                  CustomEditor.setBlockData(e, insertedBlockId, {
                    url,
                    name: file.name,
                    uploaded_at: Date.now(),
                    url_type: FieldURLType.Upload,
                    retry_local_url: '',
                    pending_upload_id: '',
                  } as FileBlockData);
                }
              })()
            );
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

function getSingleURLTextFromClipboard(data: DataTransfer): string | undefined {
  const plainText = data.getData('text/plain')?.trim();

  if (plainText && isSingleURLText(plainText)) return plainText;

  const html = data.getData('text/html')?.trim();

  if (!html) return undefined;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const textContent = doc.body.textContent?.trim();

    if (textContent && isSingleURLText(textContent)) return textContent;

    const href = doc.querySelector('a[href]')?.getAttribute('href')?.trim();

    if (href && isSingleURLText(href)) return href;
  } catch {
    return undefined;
  }

  return undefined;
}

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
 * Fragment block types whose inline text merges into the block under the
 * caret when they arrive first in a pasted fragment. Unlike external
 * HTML/markdown paste (where only paragraphs merge), an internal copy that
 * starts mid-line carries the source block's type — copying part of a heading
 * still yields a heading node — so any plain text block merges here, matching
 * Slate's `insertFragment` and the desktop editor. Code blocks keep their
 * block identity, and table cells never arrive here (handled earlier).
 */
const MERGEABLE_FIRST_FRAGMENT_TYPES = TEXT_BLOCK_TYPES.filter(
  (type) => type !== BlockType.CodeBlock && type !== BlockType.SimpleTableCellBlock
);

function shouldMergeFirstFragmentNodeInline(node: Node): boolean {
  return (
    Element.isElement(node) &&
    MERGEABLE_FIRST_FRAGMENT_TYPES.includes(node.type as BlockType) &&
    node.children.length === 1
  );
}

/**
 * Inserts a Slate fragment relative to the caret using the YJS shared doc,
 * sharing the insertion path used by `insertParsedBlocks` for HTML paste:
 * a leading text block merges inline at the cursor, everything else lands as
 * sibling blocks at the same indent level.
 *
 * Returns true if the fragment was inserted; false if the caller should fall
 * back to Slate's default `insertFragment`.
 */
function insertFragmentAsSiblings(editor: YjsEditor, fragment: Node[]): boolean {
  if (fragment.length === 0) return false;

  // Every fragment node must be a block-level element with a text wrapper
  // child — anything else (loose text, inline-only fragments) goes through
  // Slate's default path so those pastes still work.
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

  return insertBlocksAtCaret(editor, fragment as Element[], {
    mergeFirstBlockInline: shouldMergeFirstFragmentNodeInline(fragment[0]),
  });
}

function createTextDataTransfer(text: string, html?: string): DataTransfer {
  const dt = new DataTransfer();

  dt.setData('text/plain', text);

  if (html) {
    dt.setData('text/html', html);
  }

  return dt;
}
