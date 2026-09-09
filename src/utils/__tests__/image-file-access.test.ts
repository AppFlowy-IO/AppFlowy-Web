import { getTokenParsed } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

import { fetchImageBlob } from '../image';

jest.mock('@/application/session/token', () => ({ getTokenParsed: jest.fn() }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: jest.fn() }));

describe('image blob file access policy', () => {
  const originalFetch = global.fetch;
  const mockGetTokenParsed = getTokenParsed as jest.MockedFunction<typeof getTokenParsed>;
  const mockGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;
  const regularUrl = 'https://app.flowy.io/api/file_storage/workspace/v1/blob/view/image.png';
  const durableUrl =
    'https://app.flowy.io/api/workspace/public-form/' +
    'c6c31f9b-c334-4e3a-be20-79f661d4ad87/uploads/' +
    'b5860623-7ab8-40a7-a8bd-594b741d5a82';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetConfigValue.mockImplementation((key: string) => (key === 'APPFLOWY_BASE_URL' ? 'https://app.flowy.io' : ''));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fetches a regular published image anonymously without a session', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob });

    mockGetTokenParsed.mockReturnValue(null as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchImageBlob(regularUrl)).resolves.toBe(blob);
    expect(fetchMock).toHaveBeenCalledWith(regularUrl);
  });

  it('retries a regular published image anonymously after stale auth', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, blob: async () => blob });

    mockGetTokenParsed.mockReturnValue({ access_token: 'stale-token' } as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchImageBlob(regularUrl)).resolves.toBe(blob);
    expect(fetchMock).toHaveBeenNthCalledWith(1, regularUrl, {
      headers: {
        Authorization: 'Bearer stale-token',
        'x-platform': 'web-app',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, regularUrl);
  });

  it('keeps durable form images member-authenticated with no anonymous retry', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    mockGetTokenParsed.mockReturnValue({ access_token: 'stale-token' } as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchImageBlob(durableUrl)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(durableUrl, {
      headers: {
        Authorization: 'Bearer stale-token',
        'x-platform': 'web-app',
      },
    });
  });
});
