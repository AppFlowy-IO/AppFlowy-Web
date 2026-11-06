import { act, renderHook, waitFor } from '@testing-library/react';

import { appflowyLinkPreviewProvider } from '@/utils/link-preview-remote';

import { useDriveLinkName } from '../useDriveLinkName';

jest.mock('@/utils/link-preview-remote', () => ({ appflowyLinkPreviewProvider: { fetch: jest.fn() } }));
const fetchName = jest.mocked(appflowyLinkPreviewProvider.fetch);

afterEach(() => jest.resetAllMocks());
it('never looks up private files and does not reload public metadata on focus', async () => {
  fetchName.mockResolvedValue({ title: 'Roadmap', description: '' });
  const hook = renderHook(({ url }: { url?: string }) => useDriveLinkName(url), {
    initialProps: { url: undefined as string | undefined },
  });

  expect(fetchName).not.toHaveBeenCalled();
  hook.rerender({ url: 'https://docs.google.com/document/d/id' });
  await waitFor(() => expect(hook.result.current).toBe('Roadmap'));
  act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  hook.rerender({ url: 'https://docs.google.com/document/d/id' });
  expect(fetchName).toHaveBeenCalledTimes(1);
});
it('ignores stale results and aborts when the block changes or unmounts', async () => {
  let finish!: (value: { title: string; description: string }) => void;

  fetchName
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ title: 'New file', description: '' });
  const hook = renderHook(({ url }) => useDriveLinkName(url), {
    initialProps: { url: 'https://docs.google.com/document/d/old' },
  });
  const signal = fetchName.mock.calls[0][0].signal!;

  hook.rerender({ url: 'https://docs.google.com/document/d/new' });
  await waitFor(() => expect(hook.result.current).toBe('New file'));
  await act(async () => finish({ title: 'Old file', description: '' }));
  expect(hook.result.current).toBe('New file');
  expect(signal.aborted).toBe(true);
  hook.unmount();
  expect(fetchName.mock.calls[1][0].signal!.aborted).toBe(true);
});
it.each(['Google Drive', 'Sign in - Google Accounts', 'docs.google.com'])(
  'ignores generic or login metadata %s',
  async (title) => {
    fetchName.mockResolvedValue({ title, description: '' });
    const hook = renderHook(() => useDriveLinkName('https://docs.google.com/document/d/id'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current).toBeUndefined();
  }
);
