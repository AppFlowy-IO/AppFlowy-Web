import { act, renderHook } from '@testing-library/react';

import { getImageUrl, revokeBlobUrl } from '@/utils/authenticated-image';

import { useAuthenticatedImage } from './useAuthenticatedImage';

jest.mock('@/utils/authenticated-image', () => ({ getImageUrl: jest.fn(), revokeBlobUrl: jest.fn() }));
jest.mock('@/utils/file-storage-url', () => ({ isAppFlowyPublicFormUploadUrl: (src: string) => src.startsWith('/form/') }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn() } }));

describe('authenticated image source lifecycle', () => {
  const pending = new Map<string, (url: string) => void>();

  beforeEach(() => {
    jest.clearAllMocks();
    pending.clear();
    (getImageUrl as jest.Mock).mockImplementation((src: string) => new Promise<string>((resolve) => pending.set(src, resolve)));
  });

  async function resolve(src: string, url: string) {
    await act(async () => { pending.get(src)!(url); });
  }

  it('stops returning the previous blob when the source changes', async () => {
    const { result, rerender } = renderHook(({ src }) => useAuthenticatedImage(src), { initialProps: { src: '/image/a' } });

    await resolve('/image/a', 'blob:a');
    expect(result.current).toBe('blob:a');
    rerender({ src: '/image/b' });
    expect(result.current).toBe('/image/b');
    expect(revokeBlobUrl).toHaveBeenCalledWith('blob:a');
    await resolve('/image/b', 'blob:b');
    expect(result.current).toBe('blob:b');
  });

  it('releases a blob that resolves after unmount', async () => {
    const { unmount } = renderHook(() => useAuthenticatedImage('/image/late'));

    unmount();
    await resolve('/image/late', 'blob:late');
    expect(revokeBlobUrl).toHaveBeenCalledWith('blob:late');
  });

  it('does not reuse a revoked blob when returning to an earlier source', async () => {
    const { result, rerender } = renderHook(({ src }) => useAuthenticatedImage(src), { initialProps: { src: '/image/a' } });

    await resolve('/image/a', 'blob:old-a');
    rerender({ src: '/image/b' });
    rerender({ src: '/image/a' });
    expect(result.current).toBe('/image/a');
    await resolve('/image/a', 'blob:new-a');
    expect(result.current).toBe('blob:new-a');
  });

  it('keeps form attachments blank while the current source is pending', async () => {
    const { result, rerender } = renderHook(({ src }) => useAuthenticatedImage(src), { initialProps: { src: '/form/a' } });

    expect(result.current).toBe('');
    await resolve('/form/a', 'blob:form-a');
    rerender({ src: '/form/b' });
    expect(result.current).toBe('');
    await resolve('/form/b', 'blob:form-b');
    expect(result.current).toBe('blob:form-b');
  });
});
