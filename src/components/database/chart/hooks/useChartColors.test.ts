import { renderHook } from '@testing-library/react';

import { SelectOptionColor } from '@/application/database-yjs';
import {
  CHART_COLORS,
  CHECKBOX_CHECKED_COLOR,
  CHECKBOX_UNCHECKED_COLOR,
} from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';

import { CHECKBOX_CHECKED_KEY, CHECKBOX_UNCHECKED_KEY } from './chartGrouping';
import { getSelectOptionColor, useChartColors } from './useChartColors';

describe('useChartColors', () => {
  it('colors checkbox categories by their stable key, whatever the translated label', () => {
    const { result } = renderHook(() => useChartColors({ fieldType: FieldType.Checkbox }));
    const { getColorForCategory } = result.current;

    expect(getColorForCategory('Coché', CHECKBOX_CHECKED_KEY, 0)).toBe(CHECKBOX_CHECKED_COLOR);
    expect(getColorForCategory('Non coché', CHECKBOX_UNCHECKED_KEY, 1)).toBe(CHECKBOX_UNCHECKED_COLOR);
    // The English label alone no longer picks the checkbox color.
    expect(getColorForCategory('Checked', undefined, 2)).toBe(CHART_COLORS[2]);
  });

  it('colors select categories by option id, then by name', () => {
    const option = { id: 'opt-1', name: 'Done', color: SelectOptionColor.OptionColor7 };
    const { result } = renderHook(() =>
      useChartColors({ fieldType: FieldType.SingleSelect, selectOptions: [option] })
    );
    const { getColorForCategory } = result.current;

    expect(getColorForCategory('Renamed', 'opt-1', 0)).toBe(getSelectOptionColor(option));
    expect(getColorForCategory('Done', undefined, 0)).toBe(getSelectOptionColor(option));
    expect(getColorForCategory('Other', 'missing', 3)).toBe(CHART_COLORS[3]);
  });
});
