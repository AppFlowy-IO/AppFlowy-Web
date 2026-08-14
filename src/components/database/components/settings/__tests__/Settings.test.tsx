import { render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';
import Settings from '@/components/database/components/settings/Settings';

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

jest.mock('@/components/database/components/settings/GallerySettings', () => ({
  __esModule: true,
  default: () => <div data-testid='gallery-settings' />,
}));

describe('database Settings', () => {
  it('renders nothing while the database layout is unresolved', () => {
    const { container } = render(
      <Settings layout={undefined as unknown as DatabaseViewLayout}>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(container.firstChild).toBeNull();
  });

  it('uses the List settings menu for a List view', () => {
    render(
      <Settings layout={DatabaseViewLayout.List}>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(screen.getByTestId('list-settings')).toBeTruthy();
    expect(screen.queryByTestId('grid-settings')).toBeNull();
  });

  it('uses the Gallery settings menu for a Gallery view', () => {
    render(
      <Settings layout={DatabaseViewLayout.Gallery}>
        <button type='button'>Settings</button>
      </Settings>
    );

    expect(screen.getByTestId('gallery-settings')).toBeTruthy();
    expect(screen.queryByTestId('grid-settings')).toBeNull();
  });
});
