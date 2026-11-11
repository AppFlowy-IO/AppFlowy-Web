import { fireEvent, render, screen } from '@testing-library/react';

import { DatabaseViewLayout } from '@/application/types';

import FormSettings from '../FormSettings';

jest.mock('../Layout', () => ({
  __esModule: true,
  default: ({ currentLayout }: { currentLayout: DatabaseViewLayout }) => (
    <div data-testid='form-layout-row' data-layout={currentLayout}>
      Layout
    </div>
  ),
}));

it('opens a functional Form settings menu containing only Layout', () => {
  render(
    <FormSettings>
      <button>Settings</button>
    </FormSettings>
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), { key: 'Enter' });
  const menu = screen.getByTestId('form-settings-menu');

  expect(menu.textContent).toBe('Layout');
  expect(screen.getByTestId('form-layout-row').getAttribute('data-layout')).toBe(String(DatabaseViewLayout.Form));
});
