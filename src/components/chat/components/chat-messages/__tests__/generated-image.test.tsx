import { fireEvent, render, screen } from '@testing-library/react';

import { GeneratedImage } from '@/components/chat/components/chat-messages/generated-image';

const mockRetry = jest.fn();
let mockState = { src: '', phase: 'loading', isImageReady: false };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
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
  mockRetry.mockClear();
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
});
