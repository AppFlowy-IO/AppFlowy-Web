import { render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import GridSettings from '@/components/database/components/settings/GridSettings';

import type { ReactNode } from 'react';

jest.mock('@/components/database/components/settings/Properties', () => ({
  __esModule: true,
  default: () => <span>properties</span>,
}));

jest.mock('@/components/database/components/settings/Layout', () => ({
  __esModule: true,
  default: ({ currentLayout }: { currentLayout: DatabaseViewLayout }) => <span data-layout={currentLayout}>layout</span>,
}));

jest.mock('@/components/database/components/settings/GridSettingGroup', () => ({
  __esModule: true,
  default: () => <span>group</span>,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => (
    <div data-testid='grid-settings-actions'>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('GridSettings', () => {
  it('database_settings_list.dart: lists Properties, Layout, then Group', () => {
    render(
      <GridSettings>
        <button type='button'>Settings</button>
      </GridSettings>
    );

    const actions = screen.getByTestId('grid-settings-actions');

    expect(actions.textContent).toBe('propertieslayoutgroup');
    expect(actions.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe(String(DatabaseViewLayout.Grid));
  });
});
