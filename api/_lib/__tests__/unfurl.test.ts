import { unfurl } from '../unfurl';
import { isAllowedHttpUrl } from '../url-safety';

const originalFetch = global.fetch;

function mockResponse({
  body = '',
  headers = {},
  ok,
  status = 200,
}: {
  body?: string;
  headers?: Record<string, string>;
  ok?: boolean;
  status?: number;
}): Response {
  const lowerCaseHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

  return {
    body: undefined,
    headers: {
      get: (name: string) => lowerCaseHeaders[name.toLowerCase()] ?? null,
    },
    ok: ok ?? status < 400,
    status,
    text: async () => body,
  } as Response;
}

function htmlResponse(html: string, status = 200): Response {
  return mockResponse({
    body: html,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    status,
  });
}

describe('unfurl', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('rejects fetch failures so lower-priority providers can run', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    await expect(unfurl('https://example.com/path')).rejects.toThrow('network error');
  });

  it('parses metadata from non-OK responses instead of rejecting (mirrors the desktop parser)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        htmlResponse(
          '<head><meta property="og:title" content="Sign in"><meta property="og:site_name" content="Example"></head>',
          404
        )
      ) as unknown as typeof fetch;

    await expect(unfurl('https://example.com/private')).resolves.toMatchObject({
      title: 'Sign in',
      siteName: 'Example',
      logo: { url: 'https://www.google.com/s2/favicons?domain=example.com&sz=128' },
    });
  });

  it('falls back to the host title for non-OK responses without metadata', async () => {
    global.fetch = jest.fn().mockResolvedValue(htmlResponse('', 403)) as unknown as typeof fetch;

    await expect(unfurl('https://example.com/blocked')).resolves.toMatchObject({
      title: 'example.com',
      description: '',
      logo: { url: 'https://www.google.com/s2/favicons?domain=example.com&sz=128' },
    });
  });

  it('rejects redirects to blocked hosts before fetching the redirect target', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      })
    ) as unknown as typeof fetch;

    await expect(unfurl('https://example.com/redirect')).rejects.toThrow('Blocked redirect target');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects redirects to IPv4-mapped IPv6 private hosts before fetching the redirect target', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      mockResponse({
        status: 302,
        headers: { location: 'http://[::ffff:127.0.0.1]/admin' },
      })
    ) as unknown as typeof fetch;

    await expect(unfurl('https://example.com/redirect')).rejects.toThrow('Blocked redirect target');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('follows allowed redirects and extracts metadata from the final response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: { location: 'https://redirected.example/final' },
        })
      )
      .mockResolvedValueOnce(
        htmlResponse(
          '<head><meta property="og:title" content="Redirected page"><meta property="og:image" content="/cover.png"></head>'
        )
      ) as unknown as typeof fetch;

    await expect(unfurl('https://example.com/start')).resolves.toMatchObject({
      title: 'Redirected page',
      description: '',
      image: { url: 'https://redirected.example/cover.png' },
      logo: { url: 'https://www.google.com/s2/favicons?domain=redirected.example&sz=128' },
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://example.com/start',
      expect.objectContaining({ redirect: 'manual' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://redirected.example/final',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('adds a dark-mode favicon for GitHub hosts so the icon stays visible on dark UI', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        htmlResponse('<head><meta property="og:title" content="GitHub repo"></head>')
      ) as unknown as typeof fetch;

    await expect(unfurl('https://github.com/AppFlowy-IO/AppFlowy')).resolves.toMatchObject({
      title: 'GitHub repo',
      logoDark: { url: 'https://github.githubassets.com/favicons/favicon-dark.png' },
    });
  });
});

describe('url safety', () => {
  it('blocks IPv4-mapped IPv6 private address literals', () => {
    expect(isAllowedHttpUrl(new URL('http://[::ffff:127.0.0.1]/'))).toBe(false);
    expect(isAllowedHttpUrl(new URL('http://[::ffff:7f00:1]/'))).toBe(false);
    expect(isAllowedHttpUrl(new URL('http://[::ffff:c0a8:101]/'))).toBe(false);
  });

  it('allows public IPv4-mapped IPv6 address literals', () => {
    expect(isAllowedHttpUrl(new URL('http://[::ffff:0808:0808]/'))).toBe(true);
  });
});
