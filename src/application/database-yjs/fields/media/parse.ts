import * as Y from 'yjs';

import { getTypeOptions } from '@/application/database-yjs';
import { FileMediaCellData, FileMediaCellDataItem } from '@/application/database-yjs/cell.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

/**
 * A cell can briefly still hold the previous field type's payload — a plain
 * string right after a Text field is switched to Files & media, for instance.
 * Every media reader goes through here so a non-list payload renders as empty
 * instead of throwing.
 */
export function toFileMediaCellData (data: unknown): FileMediaCellData {
  if (!Array.isArray(data)) return [];

  return data.filter((item): item is FileMediaCellDataItem => Boolean(item) && typeof item === 'object');
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

    if (item.id === fileId) {
      item.name = newName;
    }

    newData.push([JSON.stringify(item)]);
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