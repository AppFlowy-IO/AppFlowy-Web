import * as Y from 'yjs';

import { getTypeOptions } from '@/application/database-yjs';
import { FileMediaCellData } from '@/application/database-yjs/cell.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

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
  data?: FileMediaCellData,
  fileId: string,
  newName: string
}) {
  const newData = new Y.Array<string>();

  data?.forEach((item) => {

    if (item.id === fileId) {
      item.name = newName;
    }

    newData.push([JSON.stringify(item)]);
  });

  return newData;
}

export function deleteFile ({ data, fileId }: {
  data?: FileMediaCellData,
  fileId: string,
}) {
  const newData = new Y.Array<string>();

  data?.forEach((item) => {
    if (item.id !== fileId) {
      newData.push([JSON.stringify(item)]);
    }
  });

  return newData;
}