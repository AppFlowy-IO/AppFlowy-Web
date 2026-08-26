import { fireEvent, render, screen } from '@testing-library/react';

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs';
import RollupPropertyMenuContent from '@/components/database/components/property/rollup/RollupPropertyMenuContent';

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

const mockUpdateRollupTypeOption = jest.fn();
const mockSelectRelationField = jest.fn();
const mockSelectTargetField = jest.fn();
const mockUseRollupData = jest.fn();

jest.mock('./useRollupData', () => ({
  useRollupData: (...args: unknown[]) => mockUseRollupData(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

type MenuItemProps = HTMLAttributes<HTMLDivElement> & {
  onSelect?: (event: Event) => void;
};

type MenuRadioItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect' | 'value'> & {
  value: string;
  onSelect?: (event: Event) => void;
};

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuGroup: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, role = 'menuitem', ...props }: MenuItemProps) => (
    <div {...props} role={role} onClick={(event) => onSelect?.(event.nativeEvent)}>
      {children}
    </div>
  ),
  DropdownMenuItemTick: () => <span data-testid={'selected-item'} />,
  DropdownMenuLabel: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuRadioGroup: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DropdownMenuRadioItem: ({ children, onSelect, value: _value, ...props }: MenuRadioItemProps) => (
    <button {...props} role={'menuitemradio'} onClick={(event) => onSelect?.(event.nativeEvent)}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DropdownMenuSubTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

function setRollupData({
  calculationType = CalculationType.Count,
  showAs = RollupDisplayMode.UniqueList,
  targetFieldType = FieldType.RichText,
  visualization = {
    type: 0,
    color: 'fill-default',
    divisor: 0,
    showNumber: false,
  },
}: {
  calculationType?: CalculationType;
  showAs?: RollupDisplayMode;
  targetFieldType?: FieldType;
  visualization?: {
    type: number;
    color: string;
    divisor: number;
    showNumber: boolean;
  };
} = {}) {
  mockUseRollupData.mockReturnValue({
    rollupOption: {
      relation_field_id: 'relation-field',
      target_field_id: 'target-field',
      calculation_type: calculationType,
      show_as: showAs,
      condition_value: 'option-1',
      visualization,
    },
    relationFields: [{ id: 'relation-field', name: 'Projects' }],
    relatedFields: [{ id: 'target-field', name: 'Status', type: targetFieldType, field: {} }],
    targetField: { id: 'target-field', name: 'Status', type: targetFieldType, field: {} },
    selectOptions: targetFieldType === FieldType.SingleSelect ? [{ id: 'option-1', name: 'In progress' }] : [],
    loadingRelated: false,
    selectRelationField: mockSelectRelationField,
    selectTargetField: mockSelectTargetField,
    updateRollupTypeOption: mockUpdateRollupTypeOption,
  });
}

describe('RollupPropertyMenuContent Calculate menu', () => {
  beforeEach(() => {
    mockUpdateRollupTypeOption.mockClear();
    mockSelectRelationField.mockClear();
    mockSelectTargetField.mockClear();
    mockUseRollupData.mockReset();
    setRollupData();
  });

  it('uses one Desktop-style Calculate field for display modes and calculations', () => {
    render(<RollupPropertyMenuContent fieldId={'rollup-field'} />);

    expect(screen.getByTestId('rollup-calculate-trigger').textContent).toContain('Show unique');
    expect(screen.getByText('Calculate')).toBeTruthy();
    expect(screen.queryByText('Calculation')).toBeNull();
    expect(screen.queryByText('Show as')).toBeNull();
    expect(screen.getByText('Show original')).toBeTruthy();
    expect(screen.getByText('Show unique values')).toBeTruthy();
    expect(screen.getByTestId('rollup-calculation-group-count')).toBeTruthy();
  });

  it('switches back to Calculated when a calculation is selected', () => {
    render(<RollupPropertyMenuContent fieldId={'rollup-field'} />);

    fireEvent.click(screen.getByTestId(`rollup-calculation-${CalculationType.Count}`));

    expect(mockUpdateRollupTypeOption).toHaveBeenCalledWith({
      calculation_type: CalculationType.Count,
      show_as: RollupDisplayMode.Calculated,
      condition_value: '',
    });
  });

  it('changes only the display mode when Show unique values is selected', () => {
    render(<RollupPropertyMenuContent fieldId={'rollup-field'} />);

    fireEvent.click(screen.getByTestId(`rollup-display-mode-${RollupDisplayMode.UniqueList}`));

    expect(mockUpdateRollupTypeOption).toHaveBeenCalledWith({ show_as: RollupDisplayMode.UniqueList });
  });

  it('does not show the Count value condition while the rollup is displayed as a list', () => {
    setRollupData({
      calculationType: CalculationType.CountValue,
      showAs: RollupDisplayMode.UniqueList,
      targetFieldType: FieldType.SingleSelect,
    });

    render(<RollupPropertyMenuContent fieldId={'rollup-field'} />);

    expect(screen.queryByText('Value')).toBeNull();
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('shows all Desktop visualization choices and persists only the changed option', () => {
    setRollupData({ targetFieldType: FieldType.Number });

    render(<RollupPropertyMenuContent fieldId={'rollup-field'} />);

    expect(screen.getByText('Show as')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rollup-visualization-1'));

    expect(mockUpdateRollupTypeOption).toHaveBeenCalledWith({ visualization_type: 1 });
  });

  it('keeps visualization settings out of the compact in-cell editor', () => {
    setRollupData({ targetFieldType: FieldType.Number });

    render(<RollupPropertyMenuContent fieldId={'rollup-field'} variant={'cell'} />);

    expect(screen.queryByTestId('rollup-visualization-settings')).toBeNull();
    expect(screen.getByText('Target property')).toBeTruthy();
  });

  it('configures color, divisor, and Show number for Bar and Ring visualizations', () => {
    setRollupData({
      targetFieldType: FieldType.Number,
      visualization: { type: 1, color: 'fill-default', divisor: 0, showNumber: false },
    });

    render(<RollupPropertyMenuContent fieldId={'rollup-field'} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Divide by' }), { target: { value: '80' } });
    expect(mockUpdateRollupTypeOption).toHaveBeenLastCalledWith({ visualization_divisor: 80 });

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show number' }));
    expect(mockUpdateRollupTypeOption).toHaveBeenLastCalledWith({ visualization_show_number: true });

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Papaya' }));
    expect(mockUpdateRollupTypeOption).toHaveBeenLastCalledWith({ visualization_color: 'text-color-2' });
  });

  it('hides Divide by for percentage calculations', () => {
    setRollupData({
      targetFieldType: FieldType.Number,
      calculationType: CalculationType.PercentNotEmpty,
      visualization: { type: 2, color: 'fill-default', divisor: 80, showNumber: false },
    });

    render(<RollupPropertyMenuContent fieldId={'rollup-field'} />);

    expect(screen.queryByRole('textbox', { name: 'Divide by' })).toBeNull();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show number' })).toBeTruthy();
  });

  it('searches the related database properties before selecting one', () => {
    const data = mockUseRollupData();

    mockUseRollupData.mockReturnValue({
      ...data,
      relatedFields: [data.relatedFields[0], { id: 'target-2', name: 'Owner', type: FieldType.Person, field: {} }],
    });
    render(<RollupPropertyMenuContent fieldId={'rollup-field'} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search for a property...' }), {
      target: { value: 'own' },
    });

    expect(screen.queryAllByText('Status')).toHaveLength(1);
    fireEvent.click(screen.getByText('Owner'));
    expect(mockSelectTargetField).toHaveBeenCalledWith(expect.objectContaining({ id: 'target-2' }));
  });
});
