import download from 'downloadjs';

import { getTokenParsed } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

import { downloadFile, openFileUrl } from '../download';

jest.mock('downloadjs', () => jest.fn());
jest.mock('@/application/session/token', () => ({ getTokenParsed: jest.fn() }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: jest.fn() }));

describe('download result status', () => {
  const mockGetTokenParsed = getTokenParsed as jest.MockedFunction<typeof getTokenParsed>;
  const mockGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;
  const durableUrl =
    'https://app.flowy.io/api/workspace/public-form/' +
    'c6c31f9b-c334-4e3a-be20-79f661d4ad87/uploads/' +
    'b5860623-7ab8-40a7-a8bd-594b741d5a82';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetConfigValue.mockImplementation((key: string) => (key === 'APPFLOWY_BASE_URL' ? 'https://app.flowy.io' : ''));
    mockGetTokenParsed.mockReturnValue({ access_token: 'secret-access-token' } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves true when a download succeeds', async () => {
    const blob = new Blob(['ok']);

    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob }) as unknown as typeof fetch;

    await expect(downloadFile(durableUrl, 'ok.pdf')).resolves.toBe(true);
    expect(download).toHaveBeenCalledWith(blob, 'ok.pdf');
  });

  it('resolves false (instead of silently succeeding) when the server rejects', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;

    await expect(downloadFile(durableUrl, 'private.txt')).resolves.toBe(false);
    expect(download).not.toHaveBeenCalled();
  });

  it('resolves false when the network throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch;

    await expect(downloadFile(durableUrl, 'offline.txt')).resolves.toBe(false);
    expect(download).not.toHaveBeenCalled();
  });

  it('resolves false when member auth is missing for durable uploads', async () => {
    const fetchMock = jest.fn();

    mockGetTokenParsed.mockReturnValue(null as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(downloadFile(durableUrl, 'private.txt')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves false and closes the popup when opening fails', async () => {
    const popup = { close: jest.fn(), location: { href: '' }, opener: window } as unknown as Window;

    jest.spyOn(window, 'open').mockReturnValue(popup);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    await expect(openFileUrl(durableUrl, '_blank', 'broken.png')).resolves.toBe(false);
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('resolves false when the popup is blocked', async () => {
    jest.spyOn(window, 'open').mockReturnValue(null);

    await expect(openFileUrl(durableUrl, '_blank', 'blocked.png')).resolves.toBe(false);
  });
});
