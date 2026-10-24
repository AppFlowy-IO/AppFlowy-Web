import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GalleryCardPreview, GalleryCardSize } from '@/application/types';
import GalleryLayoutSettings from '@/components/database/components/settings/GalleryLayoutSettings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const mockUpdate = jest.fn();
const mockSetCompactMode = jest.fn();
const mockFields: Array<{ fieldId: string; fieldType: number }> = [];

jest.mock('@/components/database/gallery/GalleryViewContext', () => ({
  useGalleryView: () => ({ compactMode: false, setCompactMode: mockSetCompactMode }),
}));
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
  useFieldsSelector: () => mockFields,
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
    jest.clearAllMocks();
    mockFields.length = 0;
  });

  it('shows the four Gallery options inline in the Layout submenu', () => {
    render(<GalleryLayoutMenu />);
    expect(screen.getByText('Gallery').className).toContain('text-text-tertiary');
    expect(screen.getByTestId('gallery-card-preview-trigger').textContent).toBe('Card previewPage cover');
    expect(screen.getByTestId('gallery-card-size-trigger').textContent).toBe('Card sizeMedium');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Fit image' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Compact mode' }).getAttribute('aria-checked')).toBe('false');
  });

  it('updates card size without dismissing the Layout submenu', async () => {
    render(<GalleryLayoutMenu />);
    await openSubmenu('gallery-card-size-trigger', 'gallery-card-size-menu');
    fireEvent.click(screen.getByTestId('gallery-card-size-large'));
    expect(mockUpdate).toHaveBeenCalledWith({ cardSize: GalleryCardSize.Large, showCover: true });
    expect(screen.getByTestId('gallery-layout-settings-menu')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('gallery-card-size-menu')).toBeNull());
  });

  it('uses the first media field when selecting Files & media', async () => {
    mockFields.push({ fieldId: 'images', fieldType: 12 });
    render(<GalleryLayoutMenu />);
    await openSubmenu('gallery-card-preview-trigger', 'gallery-card-preview-menu');
    fireEvent.click(screen.getByTestId('gallery-card-preview-2'));
    expect(mockUpdate).toHaveBeenCalledWith({
      cardPreview: GalleryCardPreview.FilesAndMedia,
      coverFieldId: 'images',
      showCover: true,
    });
  });

  it('persists fit image to the view and compact mode to the local preference', () => {
    render(<GalleryLayoutMenu />);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Fit image' }));
    expect(mockUpdate).toHaveBeenCalledWith({ fitImage: true, showCover: true });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Compact mode' }));
    expect(mockSetCompactMode).toHaveBeenCalledWith(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('gallery-layout-settings-menu')).toBeTruthy();
  });
});
