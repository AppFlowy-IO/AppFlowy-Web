import { render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import ListSettings from '@/components/database/components/settings/ListSettings';

import type { ReactNode } from 'react';

jest.mock('@/components/database/components/settings/Properties', () => ({
  __esModule: true,
  default: () => <span>properties</span>,
}));

jest.mock('@/components/database/components/settings/Layout', () => ({
  __esModule: true,
  default: ({ currentLayout }: { currentLayout: DatabaseViewLayout }) => <span data-layout={currentLayout}>layout</span>,
}));

jest.mock('@/components/database/components/settings/ListSettingGroup', () => ({
  __esModule: true,
  default: () => <span>group</span>,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => (
    <div data-testid='list-settings-actions'>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('ListSettings', () => {
  it('database_list_field_display.dart: list view has settings button with properties option', () => {
    render(
      <ListSettings>
        <button type='button'>Settings</button>
      </ListSettings>
    );

    const actions = screen.getByTestId('list-settings-actions');

    expect(actions.textContent).toBe('propertieslayoutgroup');
    expect(actions.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe(String(DatabaseViewLayout.List));
  });
});
