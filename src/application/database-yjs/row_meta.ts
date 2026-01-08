import { metaIdFromRowId } from '@/application/database-yjs/const';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { RowCoverType } from '@/application/types';
import { clampCoverOffset } from '@/utils/cover';

import type Y from 'yjs';

export function generateRowMeta(rowId: string, data: Record<string, string | boolean | null>) {
  const map = getMetaIdMap(rowId);

  const iconKey = map.get(RowMetaKey.IconId) ?? '';
  const coverKey = map.get(RowMetaKey.CoverId) ?? '';
  const isEmptyDocumentKey = map.get(RowMetaKey.IsDocumentEmpty) ?? '';
  const cover = data[RowMetaKey.CoverId] as string; // { data: string, cover_type: RowCoverType }
  const icon = data[RowMetaKey.IconId] as string;
  const isEmptyDocument = data[RowMetaKey.IsDocumentEmpty] as boolean;
  const result: {
    [key: string]: string | boolean | null;
  } = {};

  if (isEmptyDocument) {
    Object.assign(result, { [isEmptyDocumentKey]: isEmptyDocument });
  }

  if (cover) {
    Object.assign(result, { [coverKey]: cover });
  }

  if (icon) {
    Object.assign(result, { [iconKey]: icon });
  }

  return result;
}

export const metaIdMapFromRowIdMap = new Map<string, Map<RowMetaKey, string>>();

export function getRowKey(guid: string, rowId: string): string {
  return `${guid}_rows_${rowId}`;
}

export function getMetaIdMap(rowId: string) {
  const hasMetaIdMap = metaIdMapFromRowIdMap.has(rowId);

  if (!hasMetaIdMap) {
    const parser = metaIdFromRowId(rowId);
    const map = new Map<RowMetaKey, string>();

    map.set(RowMetaKey.IconId, parser(RowMetaKey.IconId));
    map.set(RowMetaKey.CoverId, parser(RowMetaKey.CoverId));
    map.set(RowMetaKey.DocumentId, parser(RowMetaKey.DocumentId));
    map.set(RowMetaKey.IsDocumentEmpty, parser(RowMetaKey.IsDocumentEmpty));
    metaIdMapFromRowIdMap.set(rowId, map);
    return map;
  }

  return metaIdMapFromRowIdMap.get(rowId) as Map<RowMetaKey, string>;
}

export function getMetaJSON(rowId: string, meta: Y.Map<unknown>) {
  const metaKeyMap = getMetaIdMap(rowId);

  const iconKey = metaKeyMap.get(RowMetaKey.IconId) ?? '';
  const coverKey = metaKeyMap.get(RowMetaKey.CoverId) ?? '';
  const documentId = metaKeyMap.get(RowMetaKey.DocumentId) ?? '';
  const isEmptyDocumentKey = metaKeyMap.get(RowMetaKey.IsDocumentEmpty) ?? '';
  const metaJson = meta.toJSON();

  const icon = (metaJson[iconKey] as string) || '';
  let cover = null;

  try {
    cover = metaJson[coverKey]
      ? (JSON.parse(metaJson[coverKey]) as {
        data: string;
        cover_type: RowCoverType;
        offset?: number;
      })
      : null;
  } catch (e) {
    // do nothing
  }

  if (cover) {
    cover = {
      ...cover,
      offset: clampCoverOffset(cover.offset),
    };
  }

  const isEmptyDocument = metaJson[isEmptyDocumentKey] as boolean;

  return {
    documentId,
    cover: cover,
    icon: icon,
    isEmptyDocument: isEmptyDocument,
  };
}
