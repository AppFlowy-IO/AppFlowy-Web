import { getTokenParsed } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

import { getImageUrl } from '../authenticated-image';

jest.mock('@/application/session/token', () => ({ getTokenParsed: jest.fn() }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: jest.fn() }));
jest.mock('@/utils/image', () => ({
  transcodeIfUnsupported: jest.fn(async (blob: Blob) => blob),
}));

describe('authenticated image access policy', () => {
  const originalFetch = global.fetch;
  const mockGetTokenParsed = getTokenParsed as jest.MockedFunction<typeof getTokenParsed>;
  const mockGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;
  const regularUrl = 'https://app.flowy.io/api/file_storage/workspace/v1/blob/view/image';
  const durableUrl =
    'https://app.flowy.io/api/workspace/public-form/' +
    'c6c31f9b-c334-4e3a-be20-79f661d4ad87/uploads/' +
    'b5860623-7ab8-40a7-a8bd-594b741d5a82';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetConfigValue.mockImplementation((key: string) => (key === 'APPFLOWY_BASE_URL' ? 'https://app.flowy.io' : ''));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('leaves a regular published image available to an anonymous browser', async () => {
    const fetchMock = jest.fn();

    mockGetTokenParsed.mockReturnValue(null as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getImageUrl(regularUrl)).resolves.toBe(regularUrl);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the anonymous regular URL when a stale token is rejected', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    mockGetTokenParsed.mockReturnValue({ access_token: 'stale-token' } as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getImageUrl(regularUrl)).resolves.toBe(regularUrl);
    expect(fetchMock).toHaveBeenCalledWith(regularUrl, {
      headers: {
        Authorization: 'Bearer stale-token',
        'x-platform': 'web-app',
      },
    });
  });

  it('does not expose a durable form upload to an anonymous fallback', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    mockGetTokenParsed.mockReturnValue({ access_token: 'stale-token' } as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getImageUrl(durableUrl)).resolves.toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
