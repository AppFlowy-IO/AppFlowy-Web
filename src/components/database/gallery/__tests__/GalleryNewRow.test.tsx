import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { GalleryCardSize } from '@/application/types';
import { getErrorMessage } from '@/utils/errors';
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

describe('GalleryNewRow Figma New page tile', () => {
  const createRow = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    createRow.mockResolvedValue(undefined);
    mockUseNewRowDispatch.mockReturnValue(createRow);
  });

  it.each([
    [GalleryCardSize.Small, '145px', '145px'],
    [GalleryCardSize.Medium, '178px', '178px'],
    [GalleryCardSize.Large, '235px', '235px'],
  ])('matches the %s Gallery card and tile heights', (cardSize, cardHeight, tileHeight) => {
    render(<GalleryNewRow cardSize={cardSize} />);

    expect(screen.getByTestId('gallery-new-row').style.minHeight).toBe(cardHeight);
    expect(screen.getByTestId('gallery-new-row-tile').style.minHeight).toBe(tileHeight);
  });

  it('disables repeated activation and exposes its busy state until creation settles', async () => {
    let resolveCreate!: () => void;
    const pendingCreate = new Promise<void>((resolve) => {
      resolveCreate = resolve;
    });

    createRow.mockReturnValue(pendingCreate);
    render(<GalleryNewRow cardSize={GalleryCardSize.Medium} />);

    const button = screen.getByRole('button', { name: 'gallery.newPage' });

    expect(button.getAttribute('aria-busy')).toBe('false');
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    fireEvent.click(button);

    expect(createRow).toHaveBeenCalledTimes(1);
    expect(createRow).toHaveBeenCalledWith({ openAfterCreate: false, tailing: true });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(!!button.querySelector('.animate-spin')).toBe(true);

    await act(async () => {
      resolveCreate();
      await pendingCreate;
    });

    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(!!button.querySelector('.animate-spin')).toBe(false);
  });

  it('reports creation failures and restores the enabled state', async () => {
    const error = new Error('Could not create row');

    createRow.mockRejectedValue(error);
    render(<GalleryNewRow cardSize={GalleryCardSize.Medium} />);

    const button = screen.getByRole('button', { name: 'gallery.newPage' });

    fireEvent.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(getErrorMessage(error)));
    expect(Log.error).toHaveBeenCalledWith('[Row creation] action failed', error);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('uses a localized fallback while preserving a non-Error rejection in the log', async () => {
    const rejection = { code: 'ROW_CREATE_FAILED' };

    createRow.mockRejectedValue(rejection);
    render(<GalleryNewRow cardSize={GalleryCardSize.Medium} />);

    fireEvent.click(screen.getByRole('button', { name: 'gallery.newPage' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(getErrorMessage(rejection)));
    expect(Log.error).toHaveBeenCalledWith('[Row creation] action failed', rejection);
  });
});
