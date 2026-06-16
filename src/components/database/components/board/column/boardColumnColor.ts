import { useMemo } from 'react';

import {
  FieldType,
  parseSelectOptionTypeOptions,
  SelectOption,
  SelectOptionColor,
  useFieldSelector,
} from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';

export interface BoardColumnColorStyle {
  backgroundColor: string;
  highlightColor: string;
  labelColor: string;
  paletteColor: string;
  textColor: string;
}

export const BOARD_COLUMN_COLOR_OPTIONS = [
  SelectOptionColor.OptionColor1,
  SelectOptionColor.OptionColor2,
  SelectOptionColor.OptionColor3,
  SelectOptionColor.OptionColor4,
  SelectOptionColor.OptionColor5,
  SelectOptionColor.OptionColor6,
  SelectOptionColor.OptionColor7,
  SelectOptionColor.OptionColor8,
  SelectOptionColor.OptionColor9,
  SelectOptionColor.OptionColor10,
];

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

const SELECT_OPTION_TO_PALETTE_COLOR: Record<SelectOptionColor, string> = {
  [SelectOptionColor.OptionColor1]: '--palette-bg-color-14',
  [SelectOptionColor.OptionColor2]: '--palette-bg-color-16',
  [SelectOptionColor.OptionColor3]: '--palette-bg-color-18',
  [SelectOptionColor.OptionColor4]: '--palette-bg-color-2',
  [SelectOptionColor.OptionColor5]: '--palette-bg-color-4',
  [SelectOptionColor.OptionColor6]: '--palette-bg-color-6',
  [SelectOptionColor.OptionColor7]: '--palette-bg-color-8',
  [SelectOptionColor.OptionColor8]: '--palette-bg-color-10',
  [SelectOptionColor.OptionColor9]: '--palette-bg-color-12',
  [SelectOptionColor.OptionColor10]: '--palette-bg-color-20',
  [SelectOptionColor.OptionColor11]: '--palette-bg-color-14',
  [SelectOptionColor.OptionColor12]: '--palette-bg-color-16',
  [SelectOptionColor.OptionColor13]: '--palette-bg-color-18',
  [SelectOptionColor.OptionColor14]: '--palette-bg-color-2',
  [SelectOptionColor.OptionColor15]: '--palette-bg-color-4',
  [SelectOptionColor.OptionColor16]: '--palette-bg-color-6',
  [SelectOptionColor.OptionColor17]: '--palette-bg-color-8',
  [SelectOptionColor.OptionColor18]: '--palette-bg-color-10',
  [SelectOptionColor.OptionColor19]: '--palette-bg-color-12',
  [SelectOptionColor.OptionColor20]: '--palette-bg-color-20',
};

const SELECT_OPTION_TO_BACKGROUND_COLOR: Record<SelectOptionColor, string> = {
  [SelectOptionColor.OptionColor1]: '--block-bg-color-14',
  [SelectOptionColor.OptionColor2]: '--block-bg-color-16',
  [SelectOptionColor.OptionColor3]: '--block-bg-color-18',
  [SelectOptionColor.OptionColor4]: '--block-bg-color-2',
  [SelectOptionColor.OptionColor5]: '--block-bg-color-4',
  [SelectOptionColor.OptionColor6]: '--block-bg-color-6',
  [SelectOptionColor.OptionColor7]: '--block-bg-color-8',
  [SelectOptionColor.OptionColor8]: '--block-bg-color-10',
  [SelectOptionColor.OptionColor9]: '--block-bg-color-12',
  [SelectOptionColor.OptionColor10]: '--block-bg-color-20',
  [SelectOptionColor.OptionColor11]: '--block-bg-color-14',
  [SelectOptionColor.OptionColor12]: '--block-bg-color-16',
  [SelectOptionColor.OptionColor13]: '--block-bg-color-18',
  [SelectOptionColor.OptionColor14]: '--block-bg-color-2',
  [SelectOptionColor.OptionColor15]: '--block-bg-color-4',
  [SelectOptionColor.OptionColor16]: '--block-bg-color-6',
  [SelectOptionColor.OptionColor17]: '--block-bg-color-8',
  [SelectOptionColor.OptionColor18]: '--block-bg-color-10',
  [SelectOptionColor.OptionColor19]: '--block-bg-color-12',
  [SelectOptionColor.OptionColor20]: '--block-bg-color-20',
};

const SELECT_OPTION_TO_LABEL_COLOR: Record<SelectOptionColor, string> = {
  [SelectOptionColor.OptionColor1]: '--block-border-color-14',
  [SelectOptionColor.OptionColor2]: '--block-border-color-16',
  [SelectOptionColor.OptionColor3]: '--block-border-color-18',
  [SelectOptionColor.OptionColor4]: '--block-border-color-2',
  [SelectOptionColor.OptionColor5]: '--block-border-color-4',
  [SelectOptionColor.OptionColor6]: '--block-border-color-6',
  [SelectOptionColor.OptionColor7]: '--block-border-color-8',
  [SelectOptionColor.OptionColor8]: '--block-border-color-10',
  [SelectOptionColor.OptionColor9]: '--block-border-color-12',
  [SelectOptionColor.OptionColor10]: '--block-border-color-20',
  [SelectOptionColor.OptionColor11]: '--block-border-color-14',
  [SelectOptionColor.OptionColor12]: '--block-border-color-16',
  [SelectOptionColor.OptionColor13]: '--block-border-color-18',
  [SelectOptionColor.OptionColor14]: '--block-border-color-2',
  [SelectOptionColor.OptionColor15]: '--block-border-color-4',
  [SelectOptionColor.OptionColor16]: '--block-border-color-6',
  [SelectOptionColor.OptionColor17]: '--block-border-color-8',
  [SelectOptionColor.OptionColor18]: '--block-border-color-10',
  [SelectOptionColor.OptionColor19]: '--block-border-color-12',
  [SelectOptionColor.OptionColor20]: '--block-border-color-20',
};

const SELECT_OPTION_TO_TEXT_COLOR: Record<SelectOptionColor, string> = {
  [SelectOptionColor.OptionColor1]: '--block-text-color-14',
  [SelectOptionColor.OptionColor2]: '--block-text-color-16',
  [SelectOptionColor.OptionColor3]: '--block-text-color-18',
  [SelectOptionColor.OptionColor4]: '--block-text-color-2',
  [SelectOptionColor.OptionColor5]: '--block-text-color-4',
  [SelectOptionColor.OptionColor6]: '--block-text-color-6',
  [SelectOptionColor.OptionColor7]: '--block-text-color-8',
  [SelectOptionColor.OptionColor8]: '--block-text-color-10',
  [SelectOptionColor.OptionColor9]: '--block-text-color-12',
  [SelectOptionColor.OptionColor10]: '--block-text-color-20',
  [SelectOptionColor.OptionColor11]: '--block-text-color-14',
  [SelectOptionColor.OptionColor12]: '--block-text-color-16',
  [SelectOptionColor.OptionColor13]: '--block-text-color-18',
  [SelectOptionColor.OptionColor14]: '--block-text-color-2',
  [SelectOptionColor.OptionColor15]: '--block-text-color-4',
  [SelectOptionColor.OptionColor16]: '--block-text-color-6',
  [SelectOptionColor.OptionColor17]: '--block-text-color-8',
  [SelectOptionColor.OptionColor18]: '--block-text-color-10',
  [SelectOptionColor.OptionColor19]: '--block-text-color-12',
  [SelectOptionColor.OptionColor20]: '--block-text-color-20',
};

function cssVar(token?: string) {
  return token ? `var(${token})` : undefined;
}

export function getBoardColumnColorStyle(color: SelectOptionColor | undefined): BoardColumnColorStyle | undefined {
  if (!color) return undefined;

  const backgroundColor = cssVar(SELECT_OPTION_TO_BACKGROUND_COLOR[color]);
  const labelColor = cssVar(SELECT_OPTION_TO_LABEL_COLOR[color]);
  const paletteColor = cssVar(SELECT_OPTION_TO_PALETTE_COLOR[color]);
  const textColor = cssVar(SELECT_OPTION_TO_TEXT_COLOR[color]);

  if (!backgroundColor || !labelColor || !paletteColor || !textColor) return undefined;

  return {
    backgroundColor,
    highlightColor: backgroundColor,
    labelColor,
    paletteColor,
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
