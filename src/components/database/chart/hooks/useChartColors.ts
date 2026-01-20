import { useCallback, useMemo } from 'react';

import { SelectOptionColor, SelectOption } from '@/application/database-yjs';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  CHART_COLORS,
  EMPTY_VALUE_COLOR,
  CHECKBOX_CHECKED_COLOR,
  CHECKBOX_UNCHECKED_COLOR,
} from '@/application/database-yjs/chart.type';
import { SelectOptionColorMap } from '@/components/database/components/cell/cell.const';

/**
 * Map SelectOptionColor enum to chart-friendly hex colors
 * These are approximate hex values matching the CSS variables
 */
const SelectOptionChartColorMap: Record<SelectOptionColor, string> = {
  [SelectOptionColor.OptionColor1]: '#8B89D7', // Purple
  [SelectOptionColor.OptionColor2]: '#C77DDF', // Pink
  [SelectOptionColor.OptionColor3]: '#D77DAB', // LightPink
  [SelectOptionColor.OptionColor4]: '#D98B5F', // Orange
  [SelectOptionColor.OptionColor5]: '#D9B83F', // Yellow
  [SelectOptionColor.OptionColor6]: '#A8C93F', // Lime
  [SelectOptionColor.OptionColor7]: '#6DB35A', // Green
  [SelectOptionColor.OptionColor8]: '#5AB89F', // Aqua
  [SelectOptionColor.OptionColor9]: '#5A9FD9', // Blue
  [SelectOptionColor.OptionColor10]: '#9BA8B8', // Cream
  [SelectOptionColor.OptionColor11]: '#4545A6', // Mint (thick)
  [SelectOptionColor.OptionColor12]: '#772F96', // Sky (thick)
  [SelectOptionColor.OptionColor13]: '#6E2343', // Lilac (thick)
  [SelectOptionColor.OptionColor14]: '#A54B24', // Pearl (thick)
  [SelectOptionColor.OptionColor15]: '#906000', // Sunset (thick)
  [SelectOptionColor.OptionColor16]: '#627300', // Coral (thick)
  [SelectOptionColor.OptionColor17]: '#456514', // Sapphire (thick)
  [SelectOptionColor.OptionColor18]: '#127B47', // Moss (thick)
  [SelectOptionColor.OptionColor19]: '#0C5B9E', // Sand (thick)
  [SelectOptionColor.OptionColor20]: '#4C5966', // Charcoal (thick)
};

/**
 * Get hex color from CSS variable at runtime
 * Falls back to a default color if the variable doesn't exist
 */
export function getCSSVariableColor(varName: string, fallback: string = CHART_COLORS[0]): string {
  if (typeof window === 'undefined') return fallback;

  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();

  return value || fallback;
}

/**
 * Get color for a SelectOption
 */
export function getSelectOptionColor(option: SelectOption): string {
  return SelectOptionChartColorMap[option.color] || CHART_COLORS[0];
}

/**
 * Get CSS variable name for a SelectOption color
 * This is useful for styling elements that support CSS variables
 */
export function getSelectOptionCSSVar(color: SelectOptionColor): string {
  return SelectOptionColorMap[color] || '--tag-fill-01-light';
}

export interface UseChartColorsOptions {
  fieldType: FieldType | null;
  selectOptions?: SelectOption[];
}

export interface UseChartColorsReturn {
  /** Get color for a category by label/optionId */
  getColorForCategory: (label: string, optionId?: string, index?: number) => string;
  /** Get color for empty category */
  emptyColor: string;
  /** Get all colors from the palette */
  palette: string[];
}

/**
 * Hook for managing chart colors based on field type and select options
 */
export function useChartColors({ fieldType, selectOptions }: UseChartColorsOptions): UseChartColorsReturn {
  // Create a map from option name to color
  const optionColorMap = useMemo(() => {
    const map = new Map<string, string>();

    if (selectOptions) {
      selectOptions.forEach((option) => {
        map.set(option.id, getSelectOptionColor(option));
        map.set(option.name, getSelectOptionColor(option));
      });
    }

    return map;
  }, [selectOptions]);

  // Get color for a specific category
  const getColorForCategory = useCallback((label: string, optionId?: string, index: number = 0): string => {
    // For checkbox fields, use specific colors
    if (fieldType === FieldType.Checkbox) {
      // Match Flutter's naming convention
      if (label === 'Checked' || label === 'Yes') {
        return CHECKBOX_CHECKED_COLOR;
      }

      if (label === 'Unchecked' || label === 'No') {
        return CHECKBOX_UNCHECKED_COLOR;
      }
    }

    // Try to get color from option map (by ID first, then by name)
    if (optionId && optionColorMap.has(optionId)) {
      return optionColorMap.get(optionId)!;
    }

    if (optionColorMap.has(label)) {
      return optionColorMap.get(label)!;
    }

    // Fallback to palette color based on index
    return CHART_COLORS[index % CHART_COLORS.length];
  }, [fieldType, optionColorMap]);

  return {
    getColorForCategory,
    emptyColor: EMPTY_VALUE_COLOR,
    palette: CHART_COLORS,
  };
}

export default useChartColors;
