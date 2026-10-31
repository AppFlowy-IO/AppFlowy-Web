/**
 * A select global filter's pick (PERFORMANCE-REPORT W4 d): the row is checked
 * in the click's own render, and the filter change, which filters every
 * widget of its sources again, is applied in a transition. Once the filter it
 * was made from is replaced, the row shows the filter as it is.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs/database.type';
import { MergedOptionEntry } from '@/application/database-yjs/global-filter-options';

import { GlobalFilterContent, GlobalFilterValue } from '../global-filters/GlobalFilterContent';

jest.mock('react-i18next', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

  return { useTranslation: () => ({ t }) };
});
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => undefined }));

const saved: GlobalFilterValue = {
  id: 'gf-dept',
  fieldType: FieldType.SingleSelect,
  condition: 0,
  content: '',
  optionNames: [],
};
const entries: MergedOptionEntry[] = [
  { key: 'sales', id: 'sale', name: 'Sales', color: 'Blue', ids: ['sale'] },
  { key: 'marketing', id: 'mktg', name: 'Marketing', color: 'Purple', ids: ['mktg'] },
];

const row = (id: string) =>
  screen
    .getAllByTestId('dashboard-global-filter-option')
    .find((element) => element.getAttribute('data-option-id') === id) as HTMLElement;

describe('a select global filter pick', () => {
  it('checks the row at once and hands the selection over, then follows the filter it gets', () => {
    const onSelectionChange = jest.fn();
    const view = render(
      <GlobalFilterContent
        filter={saved}
        onChange={jest.fn()}
        onSelectionChange={onSelectionChange}
        optionEntries={entries}
      />
    );

    fireEvent.click(row('mktg'));
    expect(row('mktg').getAttribute('data-checked')).toBe('true');
    expect(onSelectionChange).toHaveBeenCalledWith({ content: 'mktg', optionNames: ['Marketing'] });

    // A second pick before the first is applied builds on it.
    fireEvent.click(row('sale'));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ content: 'sale,mktg', optionNames: ['Sales', 'Marketing'] });

    // The applied filter replaces the pick.
    const applied = { ...saved, content: 'sale,mktg', optionNames: ['Sales', 'Marketing'] };

    act(() =>
      view.rerender(
        <GlobalFilterContent
          filter={applied}
          onChange={jest.fn()}
          onSelectionChange={onSelectionChange}
          optionEntries={entries}
        />
      )
    );
    expect(row('sale').getAttribute('data-checked')).toBe('true');
    expect(row('mktg').getAttribute('data-checked')).toBe('true');

    // The saved filter again (Edit mode): its own value, not the old pick.
    act(() =>
      view.rerender(
        <GlobalFilterContent
          filter={saved}
          onChange={jest.fn()}
          onSelectionChange={onSelectionChange}
          optionEntries={entries}
        />
      )
    );
    expect(row('sale').getAttribute('data-checked')).toBe('false');
    expect(row('mktg').getAttribute('data-checked')).toBe('false');
  });
});
