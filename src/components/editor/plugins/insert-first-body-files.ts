import { ReactEditor } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { YjsEditor } from '@/application/slate-yjs/plugins/withYjs';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import {
  createBlock,
  deleteBlock,
  getBlock,
  getBlockIndex,
  getParent,
  updateBlockParent,
} from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, FieldURLType, ImageType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { getErrorMessage } from '@/utils/errors';

/** Complete all uploads before the first body is sealed; no local-only placeholders are published. */
export function insertFirstBodyFiles(editor: ReactEditor, files: File[]): boolean {
  const e = editor as YjsEditor;

  if (!e.firstBody || files.length === 0) return false;
  const entry = getBlockEntry(e);

  if (!entry?.[0].blockId || !e.uploadFile || !e.firstBody.allowSlateMutation()) return true;
  const blockId = entry[0].blockId;
  const wasEmpty = !CustomEditor.getBlockTextContent(entry[0]);
  const command = e.firstBody.beginAsync();

  // The reservation retains File objects and the detached owner across card close.
  // A browser/tab close before upload completion is not a journaled publication.
  void (async () => {
    let failure: unknown;

    try {
      const urls = await Promise.all(
        files.map(async (file) => {
          command.run(() => undefined); // Recheck owner before each external upload.
          const url = await e.uploadFile!(file);

          if (!url) throw new Error('The row-page file upload did not complete.');
          command.run(() => undefined);
          return url;
        })
      );

      command.run(() => {
        e.flushLocalChanges();
        const root = e.sharedRoot;
        const parent = getParent(blockId, root);

        if (!getBlock(blockId, root) || !parent || !root.doc)
          throw new Error('The row-page insertion point is no longer available.');
        // Own the detached Yjs forest rather than DOM/Slate focus. An accepted
        // upload must still complete after the card disconnects its editor.
        root.doc.transact(() => {
          let index = getBlockIndex(blockId, root) + 1;

          files.forEach((file, fileIndex) => {
            const image = file.type.startsWith('image/');
            const data = image
              ? { url: urls[fileIndex], image_type: ImageType.External }
              : {
                  url: urls[fileIndex],
                  name: file.name,
                  uploaded_at: Date.now(),
                  url_type: FieldURLType.Upload,
                };
            const block = createBlock(root, { ty: image ? BlockType.ImageBlock : BlockType.FileBlock, data });

            updateBlockParent(root, block, parent, index++);
          });
          updateBlockParent(root, createBlock(root, { ty: BlockType.Paragraph, data: {} }), parent, index);
          if (wasEmpty) deleteBlock(root, blockId);
        }, CollabOrigin.LocalManual);
        e.flushLocalChanges();
      });
    } catch (error) {
      failure = error;
      notify.error(getErrorMessage(error));
    } finally {
      command.finish(failure);
    }
  })();

  return true;
}
