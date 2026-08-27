import * as Y from 'yjs';

// Import from the defining module, not the package barrel: cell.parse.ts uses
// isFileMediaItem below, and going through the barrel would be circular.
import { FileMediaCellData, FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

export function isFileMediaItem (item: unknown): item is FileMediaCellDataItem {
  return (
    Boolean(item) &&
    typeof item === 'object' &&
    typeof (item as { id?: unknown }).id === 'string'
  );
}

/**
 * A cell can briefly still hold the previous field type's payload — a plain
 * string right after a Text field is switched to Files & media, for instance.
 * Every media reader goes through here so a non-list payload renders as empty
 * instead of throwing.
 */
export function toFileMediaCellData (data: unknown): FileMediaCellData {
  if (!Array.isArray(data)) return [];

  return data.filter(isFileMediaItem);
}

/** Counts the same items as {@link toFileMediaCellData} without building the list. */
export function countFileMediaItems (data: unknown): number {
  if (!Array.isArray(data)) return 0;

  let count = 0;

  for (const item of data) {
    if (isFileMediaItem(item)) count += 1;
  }

  return count;
}

export function parseToFilesMediaCellData (newItems: FileMediaCellData) {
  const newData = new Y.Array<string>();

  newItems.forEach((item) => {
    const itemStr = JSON.stringify(item);

    newData.push([itemStr]);
  });

  return newData;
}

export function parseFileMediaTypeOptions (field: YDatabaseField) {
  const content = getTypeOptions(field)?.get(YjsDatabaseKey.content);

  if (!content) return null;

  try {
    return JSON.parse(content) as {
      hide_file_names: boolean
    };
  } catch (e) {
    return null;
  }
}

export function updateFileName ({ data, fileId, newName }: {
  data?: unknown,
  fileId: string,
  newName: string
}) {
  const newData = new Y.Array<string>();

  toFileMediaCellData(data).forEach((item) => {
    // Copy instead of assigning: `item` is the object held in the parsed cell
    // state the UI is currently rendering.
    const next = item.id === fileId ? { ...item, name: newName } : item;

    newData.push([JSON.stringify(next)]);
  });

  return newData;
}

export function deleteFile ({ data, fileId }: {
  data?: unknown,
  fileId: string,
}) {
  const newData = new Y.Array<string>();

  toFileMediaCellData(data).forEach((item) => {
    if (item.id !== fileId) {
      newData.push([JSON.stringify(item)]);
    }
  });

  return newData;
}