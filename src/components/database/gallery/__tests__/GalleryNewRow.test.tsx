import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { GalleryCardSize } from '@/application/types';
import { Log } from '@/utils/log';

import { GalleryNewRow } from '../GalleryNewRow';

jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewRowDispatch: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

jest.mock('@/utils/log', () => ({
  Log: {
    error: jest.fn(),
  },
}));

const mockUseNewRowDispatch = useNewRowDispatch as jest.MockedFunction<typeof useNewRowDispatch>;

describe('GalleryNewRow Flutter desktop parity', () => {
  const createRow = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    createRow.mockResolvedValue(undefined);
    mockUseNewRowDispatch.mockReturnValue(createRow);
  });

  it.each([
    [GalleryCardSize.Small, '152px', '168px'],
    [GalleryCardSize.Medium, '182px', '198px'],
    [GalleryCardSize.Large, '212px', '228px'],
  ])('matches the %s Gallery card and padded tile heights', (cardSize, cardHeight, tileHeight) => {
    render(<GalleryNewRow cardSize={cardSize} />);

    expect(screen.getByTestId('gallery-new-row').style.minHeight).toBe(cardHeight);
    expect(screen.getByTestId('gallery-new-row-tile').style.minHeight).toBe(tileHeight);
  });

  it('uses the Flutter surface, border, interaction, motion, and plus-icon tokens', () => {
    render(<GalleryNewRow cardSize={GalleryCardSize.Medium} />);

    const button = screen.getByTestId('gallery-new-row');
    const icon = button.querySelector('svg');

    expect(button.className).toContain('rounded-[10px]');
    expect(button.className).toContain('bg-white');
    expect(button.className).toContain('[[data-dark-mode=true]_&]:bg-[#1A202C]');
    expect(button.className).toContain('border-[rgba(31,35,41,0.14)]');
    expect(button.className).toContain('[[data-dark-mode=true]_&]:border-[#59647A]');
    expect(button.className).toContain('hover:border-[rgba(0,188,240,0.65)]');
    expect(button.className).toContain('focus-visible:border-[rgba(0,188,240,0.65)]');
    expect(button.className).toContain('hover:shadow-[0_6px_12px_rgba(31,35,41,0.10)]');
    expect(button.className).toContain('focus-visible:shadow-[0_6px_12px_rgba(31,35,41,0.10)]');
    expect(button.className).toContain('[[data-dark-mode=true]_&]:hover:shadow-[0_6px_12px_rgba(0,0,0,0.22)]');
    expect(button.className).toContain('[[data-dark-mode=true]_&]:focus-visible:shadow-[0_6px_12px_rgba(0,0,0,0.22)]');
    expect(button.className).toContain('[transition-duration:120ms]');
    expect(button.className).toContain('ease-out');
    expect(button.className).toContain('motion-reduce:transition-none');
    expect(button.className).toContain('text-[rgba(23,23,23,0.4)]');
    expect(button.className).toContain('[[data-dark-mode=true]_&]:text-[rgba(255,255,255,0.4)]');
    expect(icon?.classList.contains('h-4')).toBe(true);
    expect(icon?.classList.contains('w-4')).toBe(true);
  });

  it('disables repeated activation and exposes its busy state until creation settles', async () => {
    let resolveCreate!: () => void;
    const pendingCreate = new Promise<void>((resolve) => {
      resolveCreate = resolve;
    });

    createRow.mockReturnValue(pendingCreate);
    render(<GalleryNewRow cardSize={GalleryCardSize.Medium} />);

    const button = screen.getByRole('button', { name: 'grid.row.newRow' });

    expect(button.getAttribute('aria-busy')).toBe('false');
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    fireEvent.click(button);

    expect(createRow).toHaveBeenCalledTimes(1);
    expect(createRow).toHaveBeenCalledWith({ openAfterCreate: true, tailing: true });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);

    await act(async () => {
      resolveCreate();
      await pendingCreate;
    });

    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(false);
  });

  it('reports creation failures and restores the enabled state', async () => {
    const error = new Error('Could not create row');

    createRow.mockRejectedValue(error);
    render(<GalleryNewRow cardSize={GalleryCardSize.Medium} />);

    const button = screen.getByRole('button', { name: 'grid.row.newRow' });

    fireEvent.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(error.message));
    expect(Log.error).toHaveBeenCalledWith('[GalleryNewRow] failed to create row', error);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('uses a localized fallback while preserving a non-Error rejection in the log', async () => {
    const rejection = { code: 'ROW_CREATE_FAILED' };

    createRow.mockRejectedValue(rejection);
    render(<GalleryNewRow cardSize={GalleryCardSize.Medium} />);

    fireEvent.click(screen.getByRole('button', { name: 'grid.row.newRow' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('error.generalError'));
    expect(Log.error).toHaveBeenCalledWith('[GalleryNewRow] failed to create row', rejection);
  });
});
