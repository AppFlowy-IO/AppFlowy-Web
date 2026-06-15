import { LinkPreviewProviderContext } from '../link-preview';
import { appflowyLinkPreviewProvider } from '../link-preview-remote';

function buildContext(url: string): LinkPreviewProviderContext {
  return {
    normalizedUrl: url,
    fallbackData: { title: url, description: '' },
    parsedUrl: new URL(url),
  };
}

describe('appflowy link preview provider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('only handles http(s) urls', () => {
    expect(appflowyLinkPreviewProvider.canHandle(buildContext('https://example.com'))).toBe(true);
    expect(appflowyLinkPreviewProvider.canHandle(buildContext('http://example.com'))).toBe(true);
    expect(
      appflowyLinkPreviewProvider.canHandle({
        normalizedUrl: 'mailto:nathan@appflowy.io',
        fallbackData: { title: '', description: '' },
        parsedUrl: new URL('mailto:nathan@appflowy.io'),
      })
    ).toBe(false);
  });

  it('maps the unfurl endpoint response into preview data', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        title: 'AppFlowy',
        description: 'Bring projects, wikis, and teams together.',
        image: { url: 'https://example.com/cover.png' },
        logo: { url: 'https://example.com/favicon.svg' },
      }),
    }) as unknown as typeof fetch;

    await expect(appflowyLinkPreviewProvider.fetch(buildContext('https://example.com/path'))).resolves.toEqual({
      title: 'AppFlowy',
      description: 'Bring projects, wikis, and teams together.',
      image: { url: 'https://example.com/cover.png' },
      logo: { url: 'https://example.com/favicon.svg' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/link-preview?url=${encodeURIComponent('https://example.com/path')}`,
      expect.objectContaining({ signal: undefined })
    );
  });

  it('returns undefined so the next provider can run when the endpoint fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    await expect(appflowyLinkPreviewProvider.fetch(buildContext('https://example.com'))).resolves.toBeUndefined();
  });

  it('returns undefined when the endpoint returns no title or invalid json', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    }) as unknown as typeof fetch;

    await expect(appflowyLinkPreviewProvider.fetch(buildContext('https://example.com'))).resolves.toBeUndefined();
  });
});
