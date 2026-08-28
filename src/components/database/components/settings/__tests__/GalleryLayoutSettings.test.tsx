import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { GalleryCardPreview, GalleryCardSize } from '@/application/types';
import GalleryLayoutSettings from '@/components/database/components/settings/GalleryLayoutSettings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const mockUpdate = jest.fn();
const mockSettings = {
  cardPreview: GalleryCardPreview.PageCover,
  cardSize: GalleryCardSize.Medium,
  coverFieldId: undefined,
  fitImage: false,
  showCover: true,
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

jest.mock('@/application/database-yjs', () => ({
  FieldType: { Media: 12 },
  FieldVisibility: { AlwaysHidden: 2, AlwaysShown: 0, HideWhenEmpty: 1 },
  useFieldsSelector: () => [],
  useGalleryLayoutSettings: () => mockSettings,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateGalleryLayoutSettings: () => mockUpdate,
}));

function GalleryLayoutMenu() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Open settings</DropdownMenuTrigger>
      <DropdownMenuContent>
        <GalleryLayoutSettings />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function openSubmenu(triggerTestId: string, menuTestId: string) {
  const trigger = screen.getByTestId(triggerTestId);

  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  return screen.findByTestId(menuTestId);
}

describe('GalleryLayoutSettings', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
  });

  it('matches the Flutter Gallery panel hierarchy, spacing, and dimensions', async () => {
    render(<GalleryLayoutMenu />);

    const galleryTrigger = screen.getByTestId('gallery-layout-settings-trigger');

    expect(galleryTrigger.textContent).toContain('Gallery');
    expect(galleryTrigger.textContent).not.toContain('settings');
    expect(galleryTrigger.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    const panel = await openSubmenu('gallery-layout-settings-trigger', 'gallery-layout-settings-menu');

    expect(panel.className).toContain('w-[220px]');
    expect(panel.className).toContain('!min-w-[220px]');
    expect(panel.className).toContain('p-0');
    expect(panel.className).toContain('rounded-[10px]');
    expect(panel.className).toContain('border-0');
    expect(panel.className).toContain('bg-white');
    expect(panel.className).toContain('ring-1');
    expect(panel.className).toContain('ring-[#EDEDEE]');
    expect(panel.className).toContain('shadow-[0_4px_20px_rgba(31,35,41,0.102)]');
    expect(panel.className).toContain('[[data-dark-mode=true]_&]:bg-[#282E3A]');
    expect(panel.className).toContain('[[data-dark-mode=true]_&]:ring-[#3A3F49]');
    expect(panel.className).toContain('[[data-dark-mode=true]_&]:shadow-[0_2px_16px_rgba(0,0,0,0.478)]');
    expect(panel.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(0);
    expect(panel.querySelectorAll('[data-gallery-settings-section-gap]')).toHaveLength(3);

    ['Card size', 'Card preview', 'Cover image'].forEach((label) => {
      const header = within(panel).getByText(label);

      expect(header.className).toContain('text-xs');
      expect(header.className).toContain('font-semibold');
      expect(header.className).toContain('px-3');
      expect(header.className).toContain('py-2');
    });

    ['gallery-card-size-trigger', 'gallery-card-preview-trigger', 'gallery-fit-image-toggle'].forEach((testId) => {
      const row = screen.getByTestId(testId);

      expect(row.className).toContain('h-[26px]');
      expect(row.className).toContain('!min-h-[26px]');
    });
  });

  it('uses 100px and 140px popup content widths with Flutter shell padding and option spacing', async () => {
    render(<GalleryLayoutMenu />);
    await openSubmenu('gallery-layout-settings-trigger', 'gallery-layout-settings-menu');

    const sizeMenu = await openSubmenu('gallery-card-size-trigger', 'gallery-card-size-menu');

    expect(sizeMenu.className).toContain('w-[112px]');
    expect(sizeMenu.className).toContain('!min-w-[112px]');
    expect(sizeMenu.className).toContain('p-1.5');
    expect(sizeMenu.className).toContain('rounded-[10px]');
    expect(sizeMenu.className).toContain('ring-[#EDEDEE]');
    expect(sizeMenu.className).toContain('gap-1');
    screen.getAllByTestId(/^gallery-card-size-(small|medium|large)$/).forEach((option) => {
      expect(option.className).toContain('h-[26px]');
      expect(option.className).toContain('!min-h-[26px]');
    });

    const previewMenu = await openSubmenu('gallery-card-preview-trigger', 'gallery-card-preview-menu');

    expect(previewMenu.className).toContain('w-[152px]');
    expect(previewMenu.className).toContain('!min-w-[152px]');
    expect(previewMenu.className).toContain('p-1.5');
    expect(previewMenu.className).toContain('rounded-[10px]');
    expect(previewMenu.className).toContain('ring-[#EDEDEE]');
    expect(previewMenu.className).toContain('gap-1');
    screen.getAllByTestId(/^gallery-card-preview-\d+$/).forEach((option) => {
      expect(option.className).toContain('h-[26px]');
      expect(option.className).toContain('!min-h-[26px]');
    });
  });

  it('exposes Fit image as one checked menu item with a non-interactive Flutter-sized switch', async () => {
    render(<GalleryLayoutMenu />);
    await openSubmenu('gallery-layout-settings-trigger', 'gallery-layout-settings-menu');

    const item = screen.getByRole('menuitemcheckbox', { name: 'Fit image' });
    const visualSwitch = screen.getByTestId('gallery-fit-image-switch');

    expect(item.getAttribute('aria-checked')).toBe('false');
    expect(item.querySelector('button')).toBeNull();
    expect(visualSwitch.tagName).toBe('SPAN');
    expect(visualSwitch.getAttribute('aria-hidden')).toBe('true');
    expect(visualSwitch.className).toContain('h-4');
    expect(visualSwitch.className).toContain('w-[27px]');
    expect(visualSwitch.className).toContain('bg-[#E0E0E0]');

    fireEvent.click(item);
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        fitImage: true,
        showCover: true,
      })
    );
  });
});
