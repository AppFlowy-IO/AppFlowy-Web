import { render, screen } from '@testing-library/react';

import ListSettingGroup from '@/components/database/components/settings/ListSettingGroup';

import type { HTMLAttributes, ReactNode } from 'react';

const mockGrouping = {
  activeGroupIds: ['group-a'],
  groups: [
    {
      automaticallyHidden: false,
      collapsed: false,
      hidden: false,
      id: 'group-a',
      isDefault: false,
      label: 'Group A',
      rows: [],
      visible: true,
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
  useSetAllListGroupsVisibilityDispatch: () => jest.fn(),
  useSetListGroupVisibilityDispatch: () => jest.fn(),
  useToggleListHideEmptyGroups: () => jest.fn(),
  useUpdateDateGroupConditionDispatch: () => jest.fn(),
}));

jest.mock('@/components/database/list/ListGroupingContext', () => ({
  useListGrouping: () => mockGrouping,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children, ...props }: HTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuItemTick: () => null,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DropdownMenuSubTrigger: ({ children, ...props }: HTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock('@/components/ui/switch', () => ({
  Switch: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} readOnly type='checkbox' />,
}));

describe('ListSettingGroup', () => {
  it('exposes stable List grouping controls', () => {
    render(<ListSettingGroup />);

    expect(screen.getByTestId('list-group-settings-trigger')).toBeTruthy();
    expect(screen.getByTestId('list-group-settings-menu')).toBeTruthy();
    expect(screen.getByTestId('list-hide-empty-groups-toggle')).toBeTruthy();
    expect(screen.getByTestId('list-group-visibility-group-a')).toBeTruthy();
    expect(screen.getByTestId('list-remove-grouping')).toBeTruthy();
  });
});
