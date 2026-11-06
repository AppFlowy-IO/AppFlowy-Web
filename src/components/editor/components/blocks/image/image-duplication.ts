import { Element, Node } from 'slate';

import type { YjsEditor } from '@/application/slate-yjs';
import { BlockType, ImageBlockData } from '@/application/types';

import { isImageUploading } from './image-upload-state';

/** Recovery files belong to a single upload target, so they cannot be shared by a duplicate. */
export function hasUnfinishedImageUpload(editor: YjsEditor, node: Node): boolean {
  if (!Element.isElement(node)) return false;
  if (node.type === BlockType.ImageBlock) {
    const data = node.data as ImageBlockData;

    if (data.pending_upload_id || data.retry_local_url || (node.blockId && isImageUploading(editor, node.blockId)))
      return true;
  }

  return node.children.some((child) => hasUnfinishedImageUpload(editor, child));
}
