import { YjsEditor } from '@/application/slate-yjs';
import { getBlock } from '@/application/slate-yjs/utils/yjs';
import { ImageBlockData, YjsEditorKey } from '@/application/types';

export function imageUploadSource(data: ImageBlockData) {
  return JSON.stringify([data.url, data.image_type, data.source, data.retry_local_url, data.pending_upload_id]);
}

/** Keep source transitions visible even if an unknown type becomes known again
 * before an asynchronous upload finishes. Caption and resize edits remain safe. */
export function watchImageUploadSource(editor: YjsEditor, blockId: string) {
  const block = editor.sharedRoot ? getBlock(blockId, editor.sharedRoot) : undefined;
  const identity = () => {
    if (!block) return '';
    try {
      const data = JSON.parse(block.get(YjsEditorKey.block_data) || '{}');

      return JSON.stringify([block.get(YjsEditorKey.block_type), imageUploadSource(data)]);
    } catch {
      return undefined;
    }
  };

  const initial = identity();
  let valid = true;
  const changed = () => {
    if (identity() !== initial) valid = false;
  };

  block?.observe(changed);
  return { valid: () => valid, dispose: () => block?.unobserve(changed) };
}
