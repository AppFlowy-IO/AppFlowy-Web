import { render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import Settings from '@/components/database/components/settings/Settings';

let mockLayout = DatabaseViewLayout.Grid;

jest.mock('@/application/database-yjs', () => ({
  useDatabaseView: () => ({ get: () => mockLayout }),
}));

jest.mock('@/components/database/components/settings/GridSettings', () => ({
  __esModule: true,
  default: () => <div data-testid='grid-settings' />,
}));

jest.mock('@/components/database/components/settings/BoardSettings', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/components/settings/CalendarSettings', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/components/settings/ChartSettings', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/database/components/settings/ListSettings', () => ({
  __esModule: true,
  default: () => <div data-testid='list-settings' />,
}));

describe('database Settings', () => {
  it('uses the List settings menu for a List view', () => {
    mockLayout = DatabaseViewLayout.List;

    render(
      <Settings>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(screen.getByTestId('list-settings')).toBeTruthy();
    expect(screen.queryByTestId('grid-settings')).toBeNull();
  });
});
