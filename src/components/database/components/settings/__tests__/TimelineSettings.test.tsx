import { render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import TimelineSettings from '@/components/database/components/settings/TimelineSettings';

import type { ReactNode } from 'react';

jest.mock('@/components/database/components/settings/Properties', () => ({
  __esModule: true,
  default: () => <span>properties</span>,
}));

jest.mock('@/components/database/components/settings/Layout', () => ({
  __esModule: true,
  default: ({ currentLayout }: { currentLayout: DatabaseViewLayout }) => <span data-layout={currentLayout}>layout</span>,
}));

jest.mock('@/components/database/components/settings/TimelineSettingGroup', () => ({
  __esModule: true,
  default: () => <span>group</span>,
}));

jest.mock('@/components/database/components/settings/TimelineLayoutSettings', () => ({
  __esModule: true,
  default: () => <span>timeline</span>,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => (
    <div data-testid='timeline-settings-actions'>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('TimelineSettings', () => {
  it('database_settings_list.dart: lists Properties, Layout, Group, then Timeline settings', () => {
    render(
      <TimelineSettings>
        <button type='button'>Settings</button>
      </TimelineSettings>
    );

    const actions = screen.getByTestId('timeline-settings-actions');

    expect(actions.textContent).toBe('propertieslayoutgrouptimeline');
    expect(actions.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe(
      String(DatabaseViewLayout.Timeline)
    );
  });
});
