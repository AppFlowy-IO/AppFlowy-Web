import { getTokenParsed } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

import { checkImage, fetchImageBlob } from '../image';

jest.mock('@/application/session/token', () => ({ getTokenParsed: jest.fn() }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: jest.fn() }));

describe('image pending-upload transport capability', () => {
  const originalFetch = global.fetch;
  const mockToken = getTokenParsed as jest.MockedFunction<typeof getTokenParsed>;
  const mockConfig = getConfigValue as jest.MockedFunction<typeof getConfigValue>;
  const url = 'https://app.flowy.io/api/file_storage/workspace/v1/blob/view/image.png';

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.mockImplementation((key: string) => (key === 'APPFLOWY_BASE_URL' ? 'https://app.flowy.io' : ''));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([null, { access_token: 'current-token' }])(
    'distinguishes an admitted upload from a missing image with session %p',
    async (session) => {
      mockToken.mockReturnValue(session as never);
      // Match the server contract: legacy readers see 404; opted-in readers see retryable 503.
      const fetchMock = jest.fn(async (_url: string, options: RequestInit) => ({
        ok: false,
        status: (options.headers as Record<string, string>)['x-appflowy-media-retry'] === '1' ? 503 : 404,
        statusText: 'Upload pending',
      }));

      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(checkImage(url)).resolves.toMatchObject({ status: 503, errorKind: 'not-ready' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          headers: {
            'x-platform': 'web-app',
            'x-appflowy-media-retry': '1',
            ...(session ? { Authorization: 'Bearer current-token' } : {}),
          },
        })
      );
    }
  );

  it('keeps a definitive missing file classified as not-found', async () => {
    mockToken.mockReturnValue(null as never);
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(checkImage(url)).resolves.toMatchObject({ status: 404, errorKind: 'not-found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://external.example/api/file_storage/workspace/v1/blob/view/image.png',
    'https://app.flowy.io.evil.example/api/file_storage/workspace/v1/blob/view/image.png',
  ])('sends neither the capability nor credentials to %s', async (externalUrl) => {
    const blob = new Blob(['image'], { type: 'image/png' });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob });

    mockToken.mockReturnValue({ access_token: 'current-token' } as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchImageBlob(externalUrl)).resolves.toBe(blob);
    expect(fetchMock).toHaveBeenCalledWith(externalUrl);
  });
});
