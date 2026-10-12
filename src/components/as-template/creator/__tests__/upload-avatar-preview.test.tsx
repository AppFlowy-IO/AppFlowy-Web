import { renderHook } from '@testing-library/react';

import { usePreviewObjectUrl } from '../UploadAvatar';

describe('usePreviewObjectUrl', () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: realCreate });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: realRevoke });
  });

  it('returns null when no file is selected', () => {
    const { result } = renderHook(() => usePreviewObjectUrl(null));

    expect(result.current).toBeNull();
  });

  it('creates exactly one object URL per file and revokes on change/unmount', () => {
    const create = jest.fn((index: number) => `blob:preview-${index}`);
    let calls = 0;

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => create(calls++)),
    });
    const revoke = jest.fn();

    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke });

    const fileA = new File(['a'], 'a.png', { type: 'image/png' });
    const fileB = new File(['b'], 'b.png', { type: 'image/png' });
    const { result, rerender, unmount } = renderHook(({ file }) => usePreviewObjectUrl(file), {
      initialProps: { file: fileA as File | null },
    });

    expect(result.current).toBe('blob:preview-0');
    expect(create).toHaveBeenCalledTimes(1);

    rerender({ file: fileB });
    expect(revoke).toHaveBeenCalledWith('blob:preview-0');
    expect(result.current).toBe('blob:preview-1');

    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:preview-1');
  });
});
