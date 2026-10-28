import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { useAuthenticatedOriginalImage } from '@/components/_shared/hooks/useAuthenticatedImage';

import GalleryPreview from '../GalleryPreview';

const mockZoom = { zoomIn: jest.fn(), zoomOut: jest.fn(), resetTransform: jest.fn() };

jest.mock('react-zoom-pan-pinch', () => {
  const ReactModule = jest.requireActual<typeof React>('react');

  return {
    TransformWrapper: ReactModule.forwardRef(function TransformWrapper(
      { children }: { children: (zoom: typeof mockZoom) => React.ReactNode },
      ref: React.Ref<typeof mockZoom>
    ) {
      ReactModule.useImperativeHandle(ref, () => mockZoom);

      return <>{children(mockZoom)}</>;
    }),
    TransformComponent: ({ children }: { children: React.ReactNode }) => <div data-testid='transform'>{children}</div>,
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/_shared/hooks/useAuthenticatedImage', () => ({ useAuthenticatedOriginalImage: jest.fn() }));
jest.mock('@/utils/file-storage-url', () => ({ resolveFileUrl: (url: string) => url }));
jest.mock('@/utils/download', () => ({ downloadFile: jest.fn() }));
jest.mock('@/components/_shared/notify', () => ({ notify: { success: jest.fn() } }));

const mockUseOriginal = useAuthenticatedOriginalImage as jest.MockedFunction<typeof useAuthenticatedOriginalImage>;
const IMAGES = [{ src: 'https://app.flowy.io/api/file_storage/ws/v1/blob/view/one' }, { src: 'https://app.flowy.io/api/file_storage/ws/v1/blob/view/two' }];

function renderPreview(onClose = jest.fn()) {
  return render(
    <GalleryPreview images={IMAGES} open onClose={onClose} previewIndex={0} workspaceId='ws' viewId='view' />
  );
}

describe('GalleryPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOriginal.mockReturnValue('');
  });

  it('shows a loading indicator until the original has loaded, then fits it to the viewport', () => {
    const { rerender } = renderPreview();

    expect(screen.queryByRole('progressbar')).not.toBeNull();
    expect(screen.queryByTestId('gallery-preview-image')).toBeNull();
    expect(mockUseOriginal).toHaveBeenLastCalledWith(IMAGES[0].src);

    mockUseOriginal.mockReturnValue('blob:one');
    rerender(<GalleryPreview images={IMAGES} open onClose={jest.fn()} previewIndex={0} workspaceId='ws' viewId='view' />);

    const image = screen.getByTestId('gallery-preview-image');

    expect(image.src).toBe('blob:one');
    expect(image.style.visibility).toBe('hidden');
    expect(image.style.maxWidth).toBe('calc(100vw - 32px)');
    expect(image.style.maxHeight).toBe('calc(100vh - 200px)');

    fireEvent.load(image);

    expect(image.style.visibility).toBe('visible');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('zooms and closes from the keyboard without swallowing other keys', () => {
    const onClose = jest.fn();

    renderPreview(onClose);

    act(() => {
      fireEvent.keyDown(window, { key: '+' });
      fireEvent.keyDown(window, { key: '-' });
      fireEvent.keyDown(window, { key: '0' });
    });
    expect(mockZoom.zoomIn).toHaveBeenCalledTimes(1);
    expect(mockZoom.zoomOut).toHaveBeenCalledTimes(1);
    expect(mockZoom.resetTransform).toHaveBeenCalledTimes(1);

    const unrelated = new KeyboardEvent('keydown', { key: 'r', cancelable: true });

    act(() => {
      window.dispatchEvent(unrelated);
    });
    expect(unrelated.defaultPrevented).toBe(false);

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves to the next image with the arrow keys and resets the zoom', () => {
    renderPreview();

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });

    expect(mockUseOriginal).toHaveBeenLastCalledWith(IMAGES[1].src);
    expect(mockZoom.resetTransform).toHaveBeenCalled();
    expect(screen.queryByText('2/2')).not.toBeNull();
  });

  it('shows the zoom level', () => {
    renderPreview();

    expect(screen.getByTestId('gallery-preview-zoom').textContent).toBe('100%');
  });
});
