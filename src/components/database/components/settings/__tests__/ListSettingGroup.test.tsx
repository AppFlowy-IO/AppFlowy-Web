import { render, screen } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs';
import ListSettingGroup from '@/components/database/components/settings/ListSettingGroup';

import type { HTMLAttributes, ReactNode } from 'react';

const mockGrouping = {
  activeGroupIds: ['group-a'],
  content: '',
  fieldId: 'type',
  fieldName: 'Type',
  fieldType: FieldType.SingleSelect,
  groups: [
    {
      automaticallyHidden: false,
      collapsed: false,
      hidden: false,
      id: 'group-a',
      isDefault: false,
      label: 'Group A',
      rows: [{ height: 36, id: 'row-a' }],
      visible: true,
    },
    {
      automaticallyHidden: true,
      collapsed: false,
      hidden: false,
      id: 'group-empty',
      isDefault: false,
      label: 'Group Empty',
      rows: [],
      visible: false,
    },
  ],
  hideEmptyGroups: true,
  isGrouped: true,
  ready: true,
  visibleGroups: [],
};

jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useClearGroupByFieldDispatch: () => jest.fn(),
  useGroupByFieldDispatch: () => jest.fn(),
  usePropertiesSelector: () => ({ properties: [] }),
  useSetListGroupVisibilityDispatch: () => jest.fn(),
  useToggleListHideEmptyGroups: () => jest.fn(),
  useUpdateDateGroupConditionDispatch: () => jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch'),
  useUpdateNumberGroupConfigurationDispatch: () => jest.fn(),
}));

jest.mock('@/components/database/list/ListGroupingContext', () => ({
  useListGrouping: () => mockGrouping,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

jest.mock('@/components/ui/dropdown-menu', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');

  return {
    DropdownMenuItem: ({ children, ...props }: HTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    DropdownMenuItemTick: () => null,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuSubContent: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
      ({ children, ...props }, ref) => (
        <div {...props} ref={ref}>
          {children}
        </div>
      )
    ),
    DropdownMenuSubTrigger: ({ children, ...props }: HTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
  };
});

jest.mock('@/components/ui/switch', () => ({
  Switch: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} readOnly type='checkbox' />,
}));

describe('ListSettingGroup', () => {
  it('exposes stable List grouping controls in the desktop menu structure', () => {
    render(<ListSettingGroup />);

    expect(screen.getByTestId('list-group-settings-trigger')).toBeTruthy();
    expect(screen.getByTestId('list-group-settings-field').textContent).toBe('Type');
    expect(screen.getByTestId('list-group-settings-menu')).toBeTruthy();
    expect(screen.getByTestId('list-group-by-trigger')).toBeTruthy();
    expect(screen.getByTestId('list-group-by-current-field').textContent).toBe('Type');
    expect(screen.getByTestId('list-group-by-none')).toBeTruthy();
    expect(screen.getByTestId('list-hide-empty-groups-toggle')).toBeTruthy();
    expect(screen.getByTestId('list-group-visibility-group-a')).toBeTruthy();
    expect(screen.getByTestId('list-group-visibility-shown-group-a')).toBeTruthy();
    expect(screen.getByTestId('list-remove-grouping').textContent).toBe('Delete grouping');
  });

  it('drops the web-only bulk actions, switches and empty groups while hiding empty groups', () => {
    render(<ListSettingGroup />);

    expect(screen.queryByTestId('list-show-all-groups')).toBeNull();
    expect(screen.queryByTestId('list-hide-all-groups')).toBeNull();
    expect(screen.queryByTestId('list-group-visibility-switch-group-a')).toBeNull();
    expect(screen.queryByTestId('list-group-visibility-group-empty')).toBeNull();
  });
});
