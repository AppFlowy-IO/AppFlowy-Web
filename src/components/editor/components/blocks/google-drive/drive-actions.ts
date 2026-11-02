import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { GoogleDriveBlockNode } from '@/components/editor/editor.type';

export const DRIVE_ACTION_EVENT = 'appflowy:google-drive-action';
export type DriveAction = 'reload' | 'fullscreen' | 'caption' | 'ask';

export function writableDrive(editor: YjsEditor, blockId: string) {
  const node = findSlateEntryByBlockId(editor, blockId)?.[0];

  return node?.type === BlockType.GoogleDriveBlock && !editor.readOnly && !editor.isElementReadOnly(node)
    ? (node as GoogleDriveBlockNode)
    : undefined;
}

export function dispatchDriveAction(editor: YjsEditor, blockId: string, action: DriveAction) {
  const node = findSlateEntryByBlockId(editor, blockId)?.[0];

  if (node?.type === BlockType.GoogleDriveBlock)
    ReactEditor.toDOMNode(editor, node).dispatchEvent(new CustomEvent(DRIVE_ACTION_EVENT, { detail: action }));
}
