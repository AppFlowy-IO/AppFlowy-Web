import download from 'downloadjs';

import { getTokenParsed } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

import { downloadFile, openFileUrl } from '../download';

jest.mock('downloadjs', () => jest.fn());
jest.mock('@/application/session/token', () => ({ getTokenParsed: jest.fn() }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: jest.fn() }));

describe('authenticated form attachment downloads', () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const mockGetTokenParsed = getTokenParsed as jest.MockedFunction<typeof getTokenParsed>;
  const mockGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;
  const durableUrl =
    'https://app.flowy.io/api/workspace/public-form/' +
    'c6c31f9b-c334-4e3a-be20-79f661d4ad87/uploads/' +
    'b5860623-7ab8-40a7-a8bd-594b741d5a82';
  const regularUrl = 'https://app.flowy.io/api/file_storage/workspace/v1/blob/view/file';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetConfigValue.mockImplementation((key: string) => (key === 'APPFLOWY_BASE_URL' ? 'https://app.flowy.io' : ''));
    mockGetTokenParsed.mockReturnValue({ access_token: 'secret-access-token' } as never);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
    jest.restoreAllMocks();
  });

  it('sends bearer auth only to the exact first-party durable form upload route', async () => {
    const blob = new Blob(['evidence']);
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    global.fetch = fetchMock as unknown as typeof fetch;

    await downloadFile(durableUrl, 'evidence.pdf');

    expect(fetchMock).toHaveBeenCalledWith(durableUrl, {
      headers: {
        Authorization: 'Bearer secret-access-token',
        'x-platform': 'web-app',
      },
    });
    expect(download).toHaveBeenCalledWith(blob, 'evidence.pdf');
  });

  it('does not send bearer auth to an external lookalike route', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() });
    const externalUrl =
      'https://attacker.example/api/workspace/public-form/' +
      'c6c31f9b-c334-4e3a-be20-79f661d4ad87/uploads/' +
      'b5860623-7ab8-40a7-a8bd-594b741d5a82';

    global.fetch = fetchMock as unknown as typeof fetch;

    await downloadFile(externalUrl, 'evidence.pdf');

    expect(fetchMock).toHaveBeenCalledWith(externalUrl);
  });

  it('opens an external attachment without granting access to its opener', async () => {
    const externalUrl = 'https://files.example.test/report.pdf';
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    await openFileUrl(externalUrl, '_blank', 'report.pdf');

    expect(open).toHaveBeenCalledWith(externalUrl, '_blank', 'noopener,noreferrer');
  });

  it('downloads a regular published file anonymously when no session exists', async () => {
    const blob = new Blob(['published']);
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob });

    mockGetTokenParsed.mockReturnValue(null as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await downloadFile(regularUrl, 'published.txt');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(regularUrl);
    expect(download).toHaveBeenCalledWith(blob, 'published.txt');
  });

  it('retries a regular published file anonymously after stale auth is rejected', async () => {
    const blob = new Blob(['published']);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, blob: async () => blob });

    global.fetch = fetchMock as unknown as typeof fetch;

    await downloadFile(regularUrl, 'published.txt');

    expect(fetchMock).toHaveBeenNthCalledWith(1, regularUrl, {
      headers: {
        Authorization: 'Bearer secret-access-token',
        'x-platform': 'web-app',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, regularUrl);
    expect(download).toHaveBeenCalledWith(blob, 'published.txt');
  });

  it('never retries a durable form upload anonymously', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    global.fetch = fetchMock as unknown as typeof fetch;

    await downloadFile(durableUrl, 'private.txt');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(durableUrl, {
      headers: {
        Authorization: 'Bearer secret-access-token',
        'x-platform': 'web-app',
      },
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('does not request a durable form upload without member auth', async () => {
    const fetchMock = jest.fn();

    mockGetTokenParsed.mockReturnValue(null as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await downloadFile(durableUrl, 'private.txt');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('opens a regular published file anonymously when logged out', async () => {
    const imageBlob = new Blob(['png'], { type: 'image/png' });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => imageBlob,
    });
    const { popup } = installPopup('blob:https://app.flowy.io/anonymous');

    mockGetTokenParsed.mockReturnValue(null as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await openFileUrl(regularUrl, '_blank', 'published.png');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(regularUrl);
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe('blob:https://app.flowy.io/anonymous');
  });

  it('opens a regular published file through anonymous fallback after stale auth', async () => {
    const imageBlob = new Blob(['png'], { type: 'image/png' });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, blob: async () => imageBlob });
    const { popup } = installPopup('blob:https://app.flowy.io/stale-fallback');

    global.fetch = fetchMock as unknown as typeof fetch;

    await openFileUrl(regularUrl, '_blank', 'published.png');

    expect(fetchMock).toHaveBeenNthCalledWith(1, regularUrl, {
      headers: {
        Authorization: 'Bearer secret-access-token',
        'x-platform': 'web-app',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, regularUrl);
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe('blob:https://app.flowy.io/stale-fallback');
  });

  it('does not open or anonymously request a durable upload while logged out', async () => {
    const fetchMock = jest.fn();
    const { popup } = installPopup('blob:https://app.flowy.io/should-not-open');

    mockGetTokenParsed.mockReturnValue(null as never);
    global.fetch = fetchMock as unknown as typeof fetch;

    await openFileUrl(durableUrl, '_blank', 'private.png');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe('');
  });

  it('does not anonymously retry a durable upload rejected with stale auth', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const { popup } = installPopup('blob:https://app.flowy.io/should-not-open');

    global.fetch = fetchMock as unknown as typeof fetch;

    await openFileUrl(durableUrl, '_blank', 'private.png');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(durableUrl, {
      headers: {
        Authorization: 'Bearer secret-access-token',
        'x-platform': 'web-app',
      },
    });
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe('');
  });

  it.each(['text/html', 'application/xhtml+xml', 'image/svg+xml'])(
    'forces %s attachments to inert downloads and severs their opener',
    async (mimeType) => {
      const activeBlob = new Blob(['<script>opener.pwned = true</script>'], {
        type: mimeType,
      });
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        blob: async () => activeBlob,
      });
      const popup = {
        close: jest.fn(),
        location: { href: '' },
        opener: window,
      } as unknown as Window;
      const createObjectURL = jest.fn();

      jest.spyOn(window, 'open').mockReturnValue(popup);
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: createObjectURL,
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await openFileUrl(durableUrl, '_blank', 'payload.html');

      expect(popup.opener).toBeNull();
      expect(popup.close).toHaveBeenCalledTimes(1);
      expect(popup.location.href).toBe('');
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(download).toHaveBeenCalledTimes(1);

      const [safeBlob, filename] = (download as jest.MockedFunction<typeof download>).mock.calls[0];

      expect(safeBlob).toBeInstanceOf(Blob);
      expect((safeBlob as Blob).type).toBe('application/octet-stream');
      expect(filename).toBe('payload.html');
    }
  );

  it('opens inert raster media in a disowned popup', async () => {
    const imageBlob = new Blob(['png'], { type: 'image/png' });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => imageBlob,
    });
    const popup = {
      close: jest.fn(),
      location: { href: '' },
      opener: window,
    } as unknown as Window;
    const createObjectURL = jest.fn().mockReturnValue('blob:https://app.flowy.io/passive');

    jest.spyOn(window, 'open').mockReturnValue(popup);
    jest.spyOn(window, 'setTimeout').mockReturnValue(1);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await openFileUrl(durableUrl, '_blank', 'image.png');

    expect(popup.opener).toBeNull();
    expect(popup.close).not.toHaveBeenCalled();
    expect(popup.location.href).toBe('blob:https://app.flowy.io/passive');
    expect(createObjectURL).toHaveBeenCalledWith(imageBlob);
    expect(download).not.toHaveBeenCalled();
  });
});

function installPopup(blobUrl: string): { popup: Window; createObjectURL: jest.Mock } {
  const popup = {
    close: jest.fn(),
    location: { href: '' },
    opener: window,
  } as unknown as Window;
  const createObjectURL = jest.fn().mockReturnValue(blobUrl);

  jest.spyOn(window, 'open').mockReturnValue(popup);
  jest.spyOn(window, 'setTimeout').mockReturnValue(1);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });

  return { popup, createObjectURL };
}
