import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { FieldType, SelectOption, SelectOptionColor } from '@/application/database-yjs';
import { YDatabaseCell, YjsDatabaseKey } from '@/application/types';

export function createSelectOptionCell (fieldId: string, type: FieldType, data: string) {
  const cell = new Y.Map() as YDatabaseCell;

  cell.set(YjsDatabaseKey.id, fieldId);
  cell.set(YjsDatabaseKey.data, data);
  cell.set(YjsDatabaseKey.field_type, Number(type));
  cell.set(YjsDatabaseKey.created_at, Date.now());
  cell.set(YjsDatabaseKey.last_modified, Date.now());

  return cell;
}

export function generateOptionId () {
  return nanoid(6);
}

export function getColorByOption (options: SelectOption[]): SelectOptionColor {
  const colorFrequency = Array(10).fill(0);

  for (const option of options) {
    const colorIndex = Object.values(SelectOptionColor).indexOf(option.color);

    if (colorIndex < 10) {
      colorFrequency[colorIndex]++;
    }
  }

  let minIndex = 0;

  for (let i = 1; i < colorFrequency.length; i++) {
    if (colorFrequency[i] < colorFrequency[minIndex]) {
      minIndex = i;
    }
  }

  return Object.values(SelectOptionColor)?.[minIndex];
}
