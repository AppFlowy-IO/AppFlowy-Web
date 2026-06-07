import { useMemo } from 'react';

import {
  GROUP_COLOR_OPTIONS,
  GroupColorOption,
  groupColorOptionByName,
  groupColorOptionFromName,
} from '@/application/database-yjs';
import { ColorEnum, renderColor, toBlockColor } from '@/utils/color';

import { useBoardColumnName } from './columnName';

export interface BoardColumnColorStyle {
  backgroundColor: string;
  labelBackgroundColor: string;
  paletteColor: string;
  textColor: string;
}

export const BOARD_COLUMN_COLOR_OPTIONS = GROUP_COLOR_OPTIONS;

export type BoardColumnColorLabelKey =
  | 'colors.default'
  | 'colors.mauve'
  | 'colors.lilac'
  | 'colors.camellia'
  | 'colors.papaya'
  | 'colors.mango'
  | 'colors.olive'
  | 'colors.grass'
  | 'colors.jade'
  | 'colors.azure'
  | 'colors.gray';

const GROUP_COLOR_TO_TINT: Partial<Record<GroupColorOption, ColorEnum>> = {
  [GroupColorOption.Mauve]: ColorEnum.Tint1,
  [GroupColorOption.Lilac]: ColorEnum.Tint2,
  [GroupColorOption.Camellia]: ColorEnum.Tint3,
  [GroupColorOption.Papaya]: ColorEnum.Tint4,
  [GroupColorOption.Mango]: ColorEnum.Tint5,
  [GroupColorOption.Olive]: ColorEnum.Tint6,
  [GroupColorOption.Grass]: ColorEnum.Tint7,
  [GroupColorOption.Jade]: ColorEnum.Tint8,
  [GroupColorOption.Azure]: ColorEnum.Tint9,
  [GroupColorOption.Iron]: ColorEnum.Tint10,
};

const GROUP_COLOR_LABEL_KEYS: Record<GroupColorOption, BoardColumnColorLabelKey> = {
  [GroupColorOption.DefaultOption]: 'colors.default',
  [GroupColorOption.Mauve]: 'colors.mauve',
  [GroupColorOption.Lilac]: 'colors.lilac',
  [GroupColorOption.Camellia]: 'colors.camellia',
  [GroupColorOption.Papaya]: 'colors.papaya',
  [GroupColorOption.Mango]: 'colors.mango',
  [GroupColorOption.Olive]: 'colors.olive',
  [GroupColorOption.Grass]: 'colors.grass',
  [GroupColorOption.Jade]: 'colors.jade',
  [GroupColorOption.Azure]: 'colors.azure',
  [GroupColorOption.Iron]: 'colors.gray',
};

export function getBoardColumnColorStyle(option: GroupColorOption | undefined): BoardColumnColorStyle | undefined {
  if (!option || option === GroupColorOption.DefaultOption) return undefined;

  const tint = GROUP_COLOR_TO_TINT[option];

  if (!tint) return undefined;

  const blockColor = toBlockColor(tint);

  return {
    backgroundColor: renderColor(blockColor.bg),
    labelBackgroundColor: renderColor(blockColor.border),
    paletteColor: renderColor(tint),
    textColor: renderColor(blockColor.text),
  };
}

export function getBoardColumnColorLabelKey(option: GroupColorOption) {
  return GROUP_COLOR_LABEL_KEYS[option];
}

export function useBoardColumnColor({
  id,
  fieldId,
  groupColor,
  showColorColumns,
}: {
  id: string;
  fieldId: string;
  groupColor?: string;
  showColorColumns: boolean;
}) {
  const columnName = useBoardColumnName(id, fieldId);

  return useMemo(() => {
    if (!showColorColumns || id === fieldId) {
      return {
        option: undefined,
        style: undefined,
      };
    }

    const option = groupColorOptionFromName(groupColor) ?? groupColorOptionByName(columnName || id);

    return {
      option,
      style: getBoardColumnColorStyle(option),
    };
  }, [columnName, fieldId, groupColor, id, showColorColumns]);
}
