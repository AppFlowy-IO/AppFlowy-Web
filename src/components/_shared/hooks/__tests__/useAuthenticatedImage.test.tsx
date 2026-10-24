import { act, renderHook, waitFor } from '@testing-library/react';
import { RefObject } from 'react';

import { getImageUrl } from '@/utils/authenticated-image';
import { acquireDisplaySizeImage } from '@/utils/display-size-image-cache';

import { useAuthenticatedImage, useAuthenticatedOriginalImage } from '../useAuthenticatedImage';

jest.mock('@/utils/authenticated-image', () => ({
  getImageUrl: jest.fn(),
  revokeBlobUrl: jest.fn(),
}));
jest.mock('@/utils/display-size-image-cache', () => ({ acquireDisplaySizeImage: jest.fn() }));
jest.mock('@/utils/device-pixel-ratio', () => ({
  subscribeToDevicePixelRatio: jest.fn((listener: () => void) => {
    mockRatioListeners.add(listener);

    return () => mockRatioListeners.delete(listener);
  }),
}));

const mockRatioListeners = new Set<() => void>();

jest.mock('@/utils/file-storage-url', () => ({
  isAppFlowyAuthenticatedFileUrl: (url: string) => url.includes('/api/file_storage/'),
  isAppFlowyPublicFormUploadUrl: () => false,
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn() } }));

const mockGetImageUrl = getImageUrl as jest.MockedFunction<typeof getImageUrl>;
const mockAcquire = acquireDisplaySizeImage as jest.MockedFunction<typeof acquireDisplaySizeImage>;

const FILE_URL = 'https://app.flowy.io/api/file_storage/ws/v1/blob/view/photo';
const OTHER_FILE_URL = 'https://app.flowy.io/api/file_storage/ws/v1/blob/view/other';
const EXTERNAL_URL = 'https://example.com/photo.png';

interface Deferred {
  release: jest.Mock;
  resolve: (url: string | null) => void;
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {
    // Not used by the hook.
  }

  disconnect(): void {
    this.observed = [];
  }

  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function sizedElement(width: number, height: number): HTMLDivElement {
  const element = document.createElement('div');

  Object.defineProperty(element, 'offsetWidth', { value: width, configurable: true, writable: true });
  Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true, writable: true });

  return element;
}

function resize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'offsetWidth', { value: width, configurable: true, writable: true });
  Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true, writable: true });
  act(() => {
    FakeResizeObserver.instances.forEach((observer) => observer.fire());
  });
}

describe('useAuthenticatedImage', () => {
  const originalResizeObserver = global.ResizeObserver;
  const originalPixelRatio = window.devicePixelRatio;
  let handles: Deferred[] = [];

  beforeAll(() => {
    global.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    handles = [];
    mockRatioListeners.clear();
    FakeResizeObserver.instances = [];
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    mockGetImageUrl.mockImplementation(async (url) => (url ? `blob:full-${url.split('/').pop()}` : ''));
    mockAcquire.mockImplementation(() => {
      let resolve!: (url: string | null) => void;
      const url = new Promise<string | null>((done) => {
        resolve = done;
      });
      const release = jest.fn();

      handles.push({ release, resolve });

      return { url, release };
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: originalPixelRatio, configurable: true });
  });

  it('loads the full image as before without the option', async () => {
    const { result } = renderHook(() => useAuthenticatedImage(FILE_URL));

    expect(result.current).toBe(FILE_URL);
    await waitFor(() => expect(result.current).toBe('blob:full-photo'));
    expect(mockGetImageUrl).toHaveBeenCalledWith(FILE_URL);
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it('leaves external URLs to the browser even with the option', async () => {
    const boxRef: RefObject<HTMLElement> = { current: sizedElement(28, 28) };
    const { result } = renderHook(() => useAuthenticatedImage(EXTERNAL_URL, { fit: 'cover', boxRef }));

    expect(result.current).toBe(EXTERNAL_URL);
    await waitFor(() => expect(mockGetImageUrl).toHaveBeenCalledWith(EXTERNAL_URL));
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it('decodes to the measured box and returns nothing until it is ready', async () => {
    const boxRef: RefObject<HTMLElement> = { current: sizedElement(28, 28) };
    const { result, unmount } = renderHook(() => useAuthenticatedImage(FILE_URL, { fit: 'cover', boxRef }));

    // The protected URL is never handed to the browser while loading.
    expect(result.current).toBe('');
    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(mockAcquire).toHaveBeenCalledWith(FILE_URL, { width: 64, height: 64 }, 'cover');
    expect(FakeResizeObserver.instances[0].observed).toEqual([boxRef.current]);

    act(() => handles[0].resolve('blob:thumb-64'));
    await waitFor(() => expect(result.current).toBe('blob:thumb-64'));
    expect(mockGetImageUrl).not.toHaveBeenCalled();

    unmount();
    expect(handles[0].release).toHaveBeenCalledTimes(1);
  });

  it('scales the box by the device pixel ratio and passes the fit through', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const boxRef: RefObject<HTMLElement> = { current: sizedElement(300, 150) };

    renderHook(() => useAuthenticatedImage(FILE_URL, { fit: 'contain', boxRef }));

    expect(mockAcquire).toHaveBeenCalledWith(FILE_URL, { width: 768, height: 384 }, 'contain');
  });

  it('decodes again when the device pixel ratio changes, through one shared watcher', () => {
    const boxRef: RefObject<HTMLElement> = { current: sizedElement(100, 100) };
    const { unmount } = renderHook(() => useAuthenticatedImage(FILE_URL, { fit: 'cover', boxRef }));

    expect(mockAcquire).toHaveBeenLastCalledWith(FILE_URL, { width: 128, height: 128 }, 'cover');
    expect(mockRatioListeners.size).toBe(1);

    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    act(() => {
      mockRatioListeners.forEach((listener) => listener());
    });

    expect(mockAcquire).toHaveBeenCalledTimes(2);
    expect(mockAcquire).toHaveBeenLastCalledWith(FILE_URL, { width: 256, height: 256 }, 'cover');

    unmount();
    expect(mockRatioListeners.size).toBe(0);
  });

  it('treats a side the layout leaves at 0 as unbounded', () => {
    const boxRef: RefObject<HTMLElement> = { current: sizedElement(200, 0) };

    renderHook(() => useAuthenticatedImage(FILE_URL, { fit: 'cover', boxRef }));

    expect(mockAcquire).toHaveBeenCalledWith(FILE_URL, { width: 256, height: null }, 'cover');
  });

  it('decodes again when the box crosses a bucket and keeps the old image until the new one is ready', async () => {
    const element = sizedElement(28, 28);
    const boxRef: RefObject<HTMLElement> = { current: element };
    const { result } = renderHook(() => useAuthenticatedImage(FILE_URL, { fit: 'cover', boxRef }));

    act(() => handles[0].resolve('blob:thumb-64'));
    await waitFor(() => expect(result.current).toBe('blob:thumb-64'));

    // Still inside the 64 bucket: nothing happens.
    resize(element, 40, 40);
    expect(mockAcquire).toHaveBeenCalledTimes(1);

    resize(element, 300, 150);
    expect(mockAcquire).toHaveBeenCalledTimes(2);
    expect(mockAcquire).toHaveBeenLastCalledWith(FILE_URL, { width: 384, height: 192 }, 'cover');
    expect(result.current).toBe('blob:thumb-64');
    expect(handles[0].release).not.toHaveBeenCalled();

    act(() => handles[1].resolve('blob:thumb-384'));
    await waitFor(() => expect(result.current).toBe('blob:thumb-384'));
    expect(handles[0].release).toHaveBeenCalledTimes(1);
    expect(handles[1].release).not.toHaveBeenCalled();
  });

  it('drops a decode that a later box superseded before it finished', async () => {
    const element = sizedElement(28, 28);
    const boxRef: RefObject<HTMLElement> = { current: element };
    const { result } = renderHook(() => useAuthenticatedImage(FILE_URL, { fit: 'cover', boxRef }));

    resize(element, 300, 150);
    expect(handles[0].release).toHaveBeenCalledTimes(1);

    act(() => handles[0].resolve('blob:thumb-64'));
    act(() => handles[1].resolve('blob:thumb-384'));
    await waitFor(() => expect(result.current).toBe('blob:thumb-384'));
  });

  it('falls back to the full-size path when the image cannot be fetched', async () => {
    const boxRef: RefObject<HTMLElement> = { current: sizedElement(28, 28) };
    const { result, unmount } = renderHook(() => useAuthenticatedImage(FILE_URL, { fit: 'cover', boxRef }));

    act(() => handles[0].resolve(null));
    await waitFor(() => expect(result.current).toBe('blob:full-photo'));
    expect(handles[0].release).toHaveBeenCalledTimes(1);
    expect(mockGetImageUrl).toHaveBeenCalledWith(FILE_URL);

    const { revokeBlobUrl } = jest.requireMock('@/utils/authenticated-image') as { revokeBlobUrl: jest.Mock };

    unmount();
    expect(revokeBlobUrl).toHaveBeenCalledWith('blob:full-photo');
  });

  it('switches sources without showing the previous image', async () => {
    const boxRef: RefObject<HTMLElement> = { current: sizedElement(28, 28) };
    const { result, rerender } = renderHook(({ src }: { src: string }) => useAuthenticatedImage(src, { fit: 'cover', boxRef }), {
      initialProps: { src: FILE_URL },
    });

    act(() => handles[0].resolve('blob:thumb-photo'));
    await waitFor(() => expect(result.current).toBe('blob:thumb-photo'));

    rerender({ src: OTHER_FILE_URL });
    expect(result.current).toBe('');
    expect(handles[0].release).toHaveBeenCalledTimes(1);
    expect(mockAcquire).toHaveBeenLastCalledWith(OTHER_FILE_URL, { width: 64, height: 64 }, 'cover');

    act(() => handles[1].resolve('blob:thumb-other'));
    await waitFor(() => expect(result.current).toBe('blob:thumb-other'));
  });

  it('loads the original through the cache without measuring anything', async () => {
    const { result, unmount } = renderHook(() => useAuthenticatedOriginalImage(FILE_URL));

    expect(result.current).toBe('');
    expect(mockAcquire).toHaveBeenCalledWith(FILE_URL, { width: null, height: null }, 'contain');
    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(mockRatioListeners.size).toBe(0);

    act(() => handles[0].resolve('blob:original'));
    await waitFor(() => expect(result.current).toBe('blob:original'));

    unmount();
    expect(handles[0].release).toHaveBeenCalledTimes(1);
  });

  it('returns nothing for an empty source', () => {
    const boxRef: RefObject<HTMLElement> = { current: sizedElement(28, 28) };
    const { result } = renderHook(() => useAuthenticatedImage(undefined, { fit: 'cover', boxRef }));

    expect(result.current).toBe('');
    expect(mockAcquire).not.toHaveBeenCalled();
  });
});
