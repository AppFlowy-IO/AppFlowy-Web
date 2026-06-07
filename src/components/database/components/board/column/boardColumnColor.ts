import { useMemo } from 'react';

import {
  FieldType,
  parseSelectOptionTypeOptions,
  SelectOption,
  SelectOptionColor,
  useFieldSelector,
} from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';

export interface BoardColumnColorStyle {
  backgroundColor: string;
  highlightColor: string;
  paletteColor: string;
  textColor: string;
}

export const BOARD_COLUMN_COLOR_OPTIONS = Object.values(SelectOptionColor);

export type BoardColumnColorLabelKey =
  | 'colors.mauve'
  | 'colors.lilac'
  | 'colors.camellia'
  | 'colors.papaya'
  | 'colors.mango'
  | 'colors.olive'
  | 'colors.grass'
  | 'colors.jade'
  | 'colors.azure'
  | 'colors.iron'
  | 'colors.mauveEmphasized'
  | 'colors.lavenderEmphasized'
  | 'colors.camelliaEmphasized'
  | 'colors.papayaEmphasized'
  | 'colors.mangoEmphasized'
  | 'colors.oliveEmphasized'
  | 'colors.grassEmphasized'
  | 'colors.jadeEmphasized'
  | 'colors.azureEmphasized'
  | 'colors.ironEmphasized';

const BOARD_COLUMN_COLOR_LABEL_KEYS: Record<SelectOptionColor, BoardColumnColorLabelKey> = {
  [SelectOptionColor.OptionColor1]: 'colors.mauve',
  [SelectOptionColor.OptionColor2]: 'colors.lilac',
  [SelectOptionColor.OptionColor3]: 'colors.camellia',
  [SelectOptionColor.OptionColor4]: 'colors.papaya',
  [SelectOptionColor.OptionColor5]: 'colors.mango',
  [SelectOptionColor.OptionColor6]: 'colors.olive',
  [SelectOptionColor.OptionColor7]: 'colors.grass',
  [SelectOptionColor.OptionColor8]: 'colors.jade',
  [SelectOptionColor.OptionColor9]: 'colors.azure',
  [SelectOptionColor.OptionColor10]: 'colors.iron',
  [SelectOptionColor.OptionColor11]: 'colors.mauveEmphasized',
  [SelectOptionColor.OptionColor12]: 'colors.lavenderEmphasized',
  [SelectOptionColor.OptionColor13]: 'colors.camelliaEmphasized',
  [SelectOptionColor.OptionColor14]: 'colors.papayaEmphasized',
  [SelectOptionColor.OptionColor15]: 'colors.mangoEmphasized',
  [SelectOptionColor.OptionColor16]: 'colors.oliveEmphasized',
  [SelectOptionColor.OptionColor17]: 'colors.grassEmphasized',
  [SelectOptionColor.OptionColor18]: 'colors.jadeEmphasized',
  [SelectOptionColor.OptionColor19]: 'colors.azureEmphasized',
  [SelectOptionColor.OptionColor20]: 'colors.ironEmphasized',
};

function cssVar(token?: string) {
  return token ? `var(${token})` : undefined;
}

function withColorOpacity(color: string, opacity: number) {
  return `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
}

export function getBoardColumnColorStyle(color: SelectOptionColor | undefined): BoardColumnColorStyle | undefined {
  if (!color) return undefined;

  const optionColor = cssVar(SelectOptionColorMap[color]);
  const textColor = cssVar(SelectOptionFgColorMap[color]);

  if (!optionColor || !textColor) return undefined;

  const translucentOptionColor = withColorOpacity(optionColor, 0.4);

  return {
    backgroundColor: translucentOptionColor,
    highlightColor: translucentOptionColor,
    paletteColor: optionColor,
    textColor,
  };
}

export function getBoardColumnColorLabelKey(color: SelectOptionColor) {
  return BOARD_COLUMN_COLOR_LABEL_KEYS[color];
}

export function useBoardColumnColor({
  id,
  fieldId,
  showColorColumns,
}: {
  id: string;
  fieldId: string;
  showColorColumns: boolean;
}): { option: SelectOption | undefined; style: BoardColumnColorStyle | undefined } {
  const { field, clock } = useFieldSelector(fieldId);

  return useMemo(() => {
    if (!showColorColumns || id === fieldId || !field) {
      return {
        option: undefined,
        style: undefined,
      };
    }

    const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

    if (![FieldType.SingleSelect, FieldType.MultiSelect].includes(fieldType)) {
      return {
        option: undefined,
        style: undefined,
      };
    }

    const option = parseSelectOptionTypeOptions(field)?.options.find((option) => option?.id === id);

    return {
      option,
      style: getBoardColumnColorStyle(option?.color),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, field, fieldId, id, showColorColumns]);
}
