import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import GallerySettings from '@/components/database/components/settings/GallerySettings';
import { Button } from '@/components/ui/button';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'settings.title' ? 'Settings' : key),
  }),
}));

jest.mock('@/components/database/components/settings/Properties', () => ({
  __esModule: true,
  default: () => <div>properties</div>,
}));

jest.mock('@/components/database/components/settings/Layout', () => ({
  __esModule: true,
  default: () => <div>layout</div>,
}));

jest.mock('@/components/database/components/settings/GalleryLayoutSettings', () => ({
  __esModule: true,
  default: () => <div>gallery</div>,
  GALLERY_POPOVER_SHELL_CLASS_NAME:
    'rounded-[10px] border-0 bg-white ring-1 ring-[#EDEDEE] shadow-[0_4px_20px_rgba(31,35,41,0.102)] [[data-dark-mode=true]_&]:bg-[#282E3A] [[data-dark-mode=true]_&]:ring-[#3A3F49] [[data-dark-mode=true]_&]:shadow-[0_2px_16px_rgba(0,0,0,0.478)]',
}));

describe('GallerySettings', () => {
  it('uses the real button as the Radix trigger without ref warnings and restores focus', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(
        <GallerySettings>
          <Button data-testid='settings-trigger' type='button' variant='ghost'>
            Open
          </Button>
        </GallerySettings>
      );

      const trigger = screen.getByTestId('settings-trigger');

      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger.getAttribute('aria-label')).toBe('Settings');
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.closest('.h-7.w-7')).toBeNull();

      act(() => trigger.focus());
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });

      await waitFor(() => expect(screen.getByText('properties')).toBeTruthy());

      const menu = screen.getByRole('menu');

      expect(menu.className).toContain('w-[240px]');
      expect(menu.className).toContain('!min-w-[240px]');
      expect(menu.className).toContain('p-1.5');
      expect(menu.className).toContain('rounded-[10px]');
      expect(menu.className).toContain('border-0');
      expect(menu.className).toContain('bg-white');
      expect(menu.className).toContain('ring-1');
      expect(menu.className).toContain('ring-[#EDEDEE]');
      expect(menu.className).toContain('shadow-[0_4px_20px_rgba(31,35,41,0.102)]');
      expect(menu.className).toContain('[[data-dark-mode=true]_&]:bg-[#282E3A]');
      expect(menu.className).toContain('[[data-dark-mode=true]_&]:ring-[#3A3F49]');
      expect(menu.className).toContain('[[data-dark-mode=true]_&]:shadow-[0_2px_16px_rgba(0,0,0,0.478)]');
      fireEvent.keyDown(menu, { key: 'Escape' });

      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(
        consoleError.mock.calls.filter(([message]) =>
          String(message).includes('Function components cannot be given refs')
        )
      ).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });
});
