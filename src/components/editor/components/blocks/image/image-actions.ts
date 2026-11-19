import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';

export const IMAGE_ACTION_EVENT = 'appflowy:image-action';
export type ImageAction = 'caption' | 'link' | 'fullscreen' | 'ask';
export function imageAction(editor: YjsEditor, id: string, action: ImageAction) {
  const node = findSlateEntryByBlockId(editor, id)?.[0];

  if (node)
    ReactEditor.toDOMNode(editor, node).dispatchEvent(
      new CustomEvent(IMAGE_ACTION_EVENT, { detail: action, bubbles: true })
    );
}
