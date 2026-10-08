import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { ViewIconType } from '@/application/types';

import ViewHelmet from '../ViewHelmet';

describe('ViewHelmet favicon lifecycle', () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    document.head.innerHTML = '';
    jest.restoreAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  afterAll(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: realCreate });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: realRevoke });
  });

  it('revokes the previous emoji favicon URL when the icon changes and on unmount', async () => {
    const create = jest.fn((key: string) => `blob:favicon-${key}`);
    const revoke = jest.fn();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: (blob: Blob) => create((blob as Blob).size ? 'svg' : 'svg'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    }) as unknown as typeof fetch;

    const { rerender, unmount } = render(
      <ViewHelmet name={'Page A'} icon={{ ty: ViewIconType.Emoji, value: '😀' }} />
    );

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    rerender(<ViewHelmet name={'Page B'} icon={{ ty: ViewIconType.Emoji, value: '🎉' }} />);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(revoke).toHaveBeenCalledTimes(1);

    unmount();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('does not create a blob URL when the emoji fetch fails', async () => {
    const create = jest.fn(() => 'blob:should-not-exist');

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

    render(<ViewHelmet name={'Broken'} icon={{ ty: ViewIconType.Emoji, value: '😀' }} />);

    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
  });
});
