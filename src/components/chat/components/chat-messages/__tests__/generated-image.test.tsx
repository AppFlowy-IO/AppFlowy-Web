import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { GeneratedImage } from '@/components/chat/components/chat-messages/generated-image';
import { convertBlobToPng, fetchImageBlob } from '@/utils/image';

const mockRetry = jest.fn();
let mockState = { src: '', phase: 'loading', isImageReady: false };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/image', () => ({ fetchImageBlob: jest.fn(), convertBlobToPng: jest.fn() }));
jest.mock('@/components/_shared/gallery-preview/GalleryPreview', () => () => null);
jest.mock('@/components/editor/components/blocks/image/useImageWithRetry', () => ({
  useImageWithRetry: () => ({
    ...mockState,
    lastError: null,
    retry: mockRetry,
    onImageLoaded: jest.fn(),
    onImageError: jest.fn(),
  }),
}));

const BLOB_URL = 'https://cloud.example/api/file_storage/ws-1/v1/blob/chat-1/abc.png';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GeneratedImage', () => {
  it('explains that a generated image is still being produced while waiting', () => {
    mockState = { src: '', phase: 'loading', isImageReady: false };
    render(<GeneratedImage url={BLOB_URL} />);

    expect(screen.getByText('chat.image.generating')).toBeTruthy();
    expect(screen.getByTestId('chat-generated-image').getAttribute('data-phase')).toBe('loading');
  });

  it('offers retry and regenerate when loading gave up', () => {
    mockState = { src: '', phase: 'failed', isImageReady: false };
    const onRegenerate = jest.fn();

    render(<GeneratedImage url={BLOB_URL} onRegenerate={onRegenerate} />);

    fireEvent.click(screen.getByTestId('chat-generated-image-retry'));
    fireEvent.click(screen.getByTestId('chat-generated-image-regenerate'));

    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('shows the picture with its actions once ready', () => {
    mockState = { src: 'blob:ready', phase: 'loading', isImageReady: true };
    render(<GeneratedImage url={BLOB_URL} alt='A fox' onRegenerate={jest.fn()} />);

    const image = screen.getByAltText('A fox');

    expect(image.getAttribute('src')).toBe('blob:ready');
    expect(screen.getByTestId('chat-generated-image-download')).toBeTruthy();
    expect(screen.getByTestId('chat-generated-image-copy')).toBeTruthy();
    expect(screen.getByTestId('chat-generated-image-regenerate')).toBeTruthy();
    expect(screen.queryByText('chat.image.generating')).toBeNull();
  });

  describe('image clipboard', () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const originalClipboardItem = Object.getOwnPropertyDescriptor(window, 'ClipboardItem');
    const write = jest.fn();
    const ClipboardItemMock = jest.fn((data: Record<string, Promise<Blob>>) => ({
      getType: (type: string) => data[type],
    }));

    beforeEach(() => {
      mockState = { src: 'blob:ready', phase: 'loading', isImageReady: true };
      write.mockReset().mockImplementation(async (items: ClipboardItem[]) => {
        await items[0].getType('image/png');
      });
      jest.mocked(fetchImageBlob).mockReset();
      jest.mocked(convertBlobToPng).mockReset();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
      Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: ClipboardItemMock });
    });

    afterEach(() => jest.restoreAllMocks());

    afterAll(() => {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
      if (originalClipboardItem) Object.defineProperty(window, 'ClipboardItem', originalClipboardItem);
      else Reflect.deleteProperty(window, 'ClipboardItem');
    });

    it.each(['image/png', 'image/jpeg'])(
      'starts copying %s within the click before image loading completes',
      async (type) => {
        let finishFetch!: (blob: Blob) => void;
        let finishConversion!: (blob: Blob) => void;
        const image = new Blob(['image'], { type });
        const png = type === 'image/png' ? image : new Blob(['png'], { type: 'image/png' });

        jest.mocked(fetchImageBlob).mockReturnValue(
          new Promise((resolve) => {
            finishFetch = resolve;
          })
        );
        jest.mocked(convertBlobToPng).mockReturnValue(
          new Promise((resolve) => {
            finishConversion = resolve;
          })
        );
        render(<GeneratedImage url={BLOB_URL} />);

        fireEvent.click(screen.getByTestId('chat-generated-image-copy'));

        expect(write).toHaveBeenCalledTimes(1);
        expect(ClipboardItemMock.mock.calls[0][0]['image/png']).toBeInstanceOf(Promise);
        expect(fetchImageBlob).toHaveBeenCalledWith(BLOB_URL);
        expect(convertBlobToPng).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();

        await act(async () => finishFetch(image));
        if (type !== 'image/png') {
          expect(convertBlobToPng).toHaveBeenCalledWith(image);
          expect(toast.success).not.toHaveBeenCalled();
          await act(async () => finishConversion(png));
        } else {
          expect(convertBlobToPng).not.toHaveBeenCalled();
        }

        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('chat.image.copied', { duration: 2000 }));
        expect(await write.mock.calls[0][0][0].getType('image/png')).toBe(png);
      }
    );

    it.each(['fetch', 'conversion', 'permission'])('reports a copy failure when %s fails', async (failure) => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest
        .mocked(fetchImageBlob)
        .mockResolvedValue(failure === 'fetch' ? null : new Blob(['jpeg'], { type: 'image/jpeg' }));
      jest.mocked(convertBlobToPng).mockRejectedValue(new Error('PNG conversion failed'));
      if (failure === 'permission') write.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
      render(<GeneratedImage url={BLOB_URL} />);

      fireEvent.click(screen.getByTestId('chat-generated-image-copy'));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('chat.image.copyFailed'));
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
