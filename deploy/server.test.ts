/** @jest-environment node */

import { jest } from '@jest/globals';
import { load } from 'cheerio';

const mockBunFetch = jest.fn();
const mockReadFileSync = jest.fn();

jest.mock('pino', () => () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

jest.mock(
  'bun',
  () => ({
    fetch: (...args: unknown[]) => mockBunFetch(...args),
  }),
  { virtual: true }
);

describe('deploy/server', () => {
  const htmlTemplate = `
    <html>
      <head>
        <title>AppFlowy</title>
        <meta name="description" content="">
        <meta property="og:image" content="">
        <link rel="icon" href="/appflowy.ico">
        <link rel="canonical" href="">
      </head>
      <body><div id="root"></div></body>
    </html>
  `;

  let createServer: typeof import('./server').createServer;
  let start: typeof import('./server').start;

  const makeRequest = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('host', 'appflowy.test');

    return new Request(`https://appflowy.test${path}`, {
      ...init,
      method: init.method ?? 'GET',
      headers,
    });
  };

  const getHtml = async (response: Response) => await response.text();

  const extractPublishError = (html: string) => {
    const $ = load(html);
    const scriptContent = $('#appflowy-publish-error').html();

    if (!scriptContent) return undefined;

    const match = scriptContent.match(/window.__APPFLOWY_PUBLISH_ERROR__ = (.*);/);
    if (!match) return undefined;

    return JSON.parse(match[1]);
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APPFLOWY_BASE_URL = 'https://api.example.com';
    const globalAny = global as typeof globalThis & { btoa?: (value: string) => string };

    if (!globalAny.btoa) {
      globalAny.btoa = (value: string) => Buffer.from(value, 'binary').toString('base64');
    }

    ({ createServer, start } = await import('./server'));
  });

  beforeEach(() => {
    mockBunFetch.mockReset();
    mockReadFileSync.mockReset();
    mockReadFileSync.mockReturnValue(htmlTemplate);
  });

  it('redirects "/" to /app without hitting the API', async () => {
    const response = await createServer(makeRequest('/'));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/app');
    expect(mockBunFetch).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('renders marketing routes with custom metadata', async () => {
    const response = await createServer(makeRequest('/login'));
    const html = await getHtml(response);
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('title').text()).toBe('Login | AppFlowy');
    expect($('meta[name="description"]').attr('content')).toBe('Login to AppFlowy');
    expect(mockBunFetch).not.toHaveBeenCalled();
    expect(mockReadFileSync).toHaveBeenCalled();
  });

  it('renders /after-payment route with payment metadata', async () => {
    const response = await createServer(makeRequest('/after-payment'));
    const html = await getHtml(response);
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('title').text()).toBe('Payment Success | AppFlowy');
    expect($('meta[name="description"]').attr('content')).toBe('Payment success on AppFlowy');
  });

  it('renders /app route without custom metadata', async () => {
    const response = await createServer(makeRequest('/app'));
    const html = await getHtml(response);
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('title').text()).toBe('AppFlowy');
    expect(mockBunFetch).not.toHaveBeenCalled();
  });

  it('renders /as-template route', async () => {
    const response = await createServer(makeRequest('/as-template'));

    expect(response.status).toBe(200);
    expect(mockBunFetch).not.toHaveBeenCalled();
  });

  it('renders /accept-invitation route', async () => {
    const response = await createServer(makeRequest('/accept-invitation'));

    expect(response.status).toBe(200);
    expect(mockBunFetch).not.toHaveBeenCalled();
  });

  it('renders /import route', async () => {
    const response = await createServer(makeRequest('/import'));

    expect(response.status).toBe(200);
    expect(mockBunFetch).not.toHaveBeenCalled();
  });

  it('renders sub-paths of marketing routes like /app/workspace', async () => {
    const response = await createServer(makeRequest('/app/workspace/123'));

    expect(response.status).toBe(200);
    expect(mockBunFetch).not.toHaveBeenCalled();
  });

  it('redirects namespace-only requests when publish info exists', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { info: { namespace: 'space', publish_name: 'hello world' } },
      }),
    });

    const response = await createServer(makeRequest('/space'));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/space/hello%20world');
    expect(mockBunFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/workspace/published/space',
      { verbose: false }
    );
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('re-encodes namespace when fetching metadata for namespace routes', async () => {
    const namespace = 'space slug';
    const encodedNamespace = encodeURIComponent(namespace);

    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { info: { namespace, publish_name: 'home page' } },
      }),
    });

    const response = await createServer(makeRequest(`/${encodedNamespace}`));

    expect(response.status).toBe(302);
    expect(mockBunFetch).toHaveBeenCalledWith(
      `https://api.example.com/api/workspace/published/${encodedNamespace}`,
      { verbose: false }
    );
  });

  it('injects error payload when namespace has no default publish page', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    const encodedNamespace = encodeURIComponent('foo<bar>');
    const response = await createServer(makeRequest(`/${encodedNamespace}`));
    const html = await getHtml(response);
    const payload = extractPublishError(html);

    expect(payload).toMatchObject({
      code: 'NO_DEFAULT_PAGE',
      namespace: 'foo<bar>',
    });

    const scriptText = load(html)('#appflowy-publish-error').html()!;
    expect(scriptText).toContain('\\u003cbar\\u003e');
    expect(scriptText).not.toContain('<bar>');
  });

  it('renders publish pages when metadata exists', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
            icon: { ty: 0, value: '😀' },
            extra: JSON.stringify({ cover: { type: 'custom', value: 'https://img/pic.png' } }),
          },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('title').text()).toContain('Doc | AppFlowy');
    expect(extractPublishError(html)).toBeUndefined();
    expect(mockBunFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/workspace/v1/published/space/doc',
      { verbose: false }
    );
  });

  it('re-encodes namespace and publishName when fetching metadata for publish pages', async () => {
    const namespace = 'team slug';
    const publishName = 'hello world';
    const encodedNamespace = encodeURIComponent(namespace);
    const encodedPublishName = encodeURIComponent(publishName);

    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
          },
        },
      }),
    });

    const response = await createServer(makeRequest(`/${encodedNamespace}/${encodedPublishName}`));
    const html = await getHtml(response);

    expect(response.status).toBe(200);
    expect(extractPublishError(html)).toBeUndefined();
    expect(mockBunFetch).toHaveBeenCalledWith(
      `https://api.example.com/api/workspace/v1/published/${encodedNamespace}/${encodedPublishName}`,
      { verbose: false }
    );
  });

  it('sets emoji favicon when icon ty=0', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
            icon: { ty: 0, value: '😀' },
          },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('link[rel="icon"]').attr('href')).toContain('emoji_u1f600.svg');
  });

  it('sets custom icon favicon when icon ty=2', async () => {
    const iconValue = JSON.stringify({
      iconContent: '<svg><path d="M10"/></svg>',
      color: '0xFF0000FF',
    });

    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
            icon: { ty: 2, value: iconValue },
          },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('link[rel="icon"]').attr('href')).toContain('data:image/svg+xml;base64,');
    expect($('link[rel="icon"]').attr('type')).toBe('image/svg+xml');
  });

  it('handles invalid icon JSON gracefully', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
            icon: { ty: 2, value: 'invalid json' },
          },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('title').text()).toContain('Doc');
  });

  it('uses built_in cover image path', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
            extra: JSON.stringify({ cover: { type: 'built_in', value: '1' } }),
          },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('meta[property="og:image"]').attr('content')).toBe('/covers/m_cover_image_1.png');
  });

  it('uses unsplash cover image', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
            extra: JSON.stringify({ cover: { type: 'unsplash', value: 'https://unsplash.com/photo.jpg' } }),
          },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('meta[property="og:image"]').attr('content')).toBe('https://unsplash.com/photo.jpg');
  });

  it('handles invalid extra JSON gracefully', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
            extra: 'not valid json',
          },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('title').text()).toContain('Doc');
    expect($('meta[property="og:image"]').attr('content')).toBe('/og-image.png');
  });

  it('captures HTTP errors as FETCH_ERROR', async () => {
    mockBunFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const payload = extractPublishError(html);

    expect(payload?.code).toBe('FETCH_ERROR');
    expect(payload?.detail).toContain('HTTP error');
  });

  it('injects publish view lookup errors when metadata request fails validation', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 404,
        data: { message: 'not found' },
      }),
    });

    const response = await createServer(makeRequest('/team/home'));
    const html = await getHtml(response);
    const payload = extractPublishError(html);

    expect(payload).toMatchObject({
      code: 'PUBLISH_VIEW_LOOKUP_FAILED',
      namespace: 'team',
      publishName: 'home',
    });
  });

  it('marks fallback renders when metadata payload is empty', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: null,
      }),
    });

    const response = await createServer(makeRequest('/org/page'));
    const html = await getHtml(response);
    const payload = extractPublishError(html);

    expect(payload).toMatchObject({
      code: 'UNKNOWN_FALLBACK',
      namespace: 'org',
      publishName: 'page',
    });
  });

  it('captures fetch failures as FETCH_ERROR', async () => {
    mockBunFetch.mockRejectedValue(new Error('network down'));

    const response = await createServer(makeRequest('/alpha/doc'));
    const html = await getHtml(response);
    const payload = extractPublishError(html);

    expect(payload?.code).toBe('FETCH_ERROR');
    expect(payload?.detail).toContain('network down');
  });

  it('returns 405 for non-GET methods', async () => {
    const response = await createServer(
      makeRequest('/namespace/page', { method: 'POST', body: 'data' })
    );

    expect(response.status).toBe(405);
  });

  it('start() wires Bun.serve to createServer', () => {
    const previousBun = (globalThis as unknown as { Bun?: unknown }).Bun;
    const serve = jest.fn();

    (globalThis as unknown as { Bun?: unknown }).Bun = { serve };

    start();

    expect(serve).toHaveBeenCalledTimes(1);
    const args = serve.mock.calls[0][0];
    expect(args.port).toBe(3000);
    expect(args.fetch).toBe(createServer);

    const errorResponse = args.error(new Error('boom'));
    expect(errorResponse.status).toBe(500);

    if (previousBun) {
      (globalThis as unknown as { Bun?: unknown }).Bun = previousBun;
    } else {
      delete (globalThis as unknown as { Bun?: unknown }).Bun;
    }
  });

  it('start() exits process on Bun.serve error', () => {
    const previousBun = (globalThis as unknown as { Bun?: unknown }).Bun;
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    (globalThis as unknown as { Bun?: unknown }).Bun = {
      serve: () => {
        throw new Error('serve failed');
      },
    };

    start();

    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    if (previousBun) {
      (globalThis as unknown as { Bun?: unknown }).Bun = previousBun;
    } else {
      delete (globalThis as unknown as { Bun?: unknown }).Bun;
    }
  });

  it('creates meta tags that do not exist in template', async () => {
    const minimalTemplate = `
      <html>
        <head>
          <title>AppFlowy</title>
        </head>
        <body><div id="root"></div></body>
      </html>
    `;
    mockReadFileSync.mockReturnValue(minimalTemplate);

    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: { name: 'Doc' },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('meta[property="og:title"]').attr('content')).toBe('Doc | AppFlowy');
    expect($('meta[property="og:description"]').length).toBe(1);
    expect($('meta[name="twitter:card"]').attr('content')).toBe('summary_large_image');
  });

  it('handles view without name gracefully', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {},
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('title').text()).toBe('AppFlowy');
  });

  it('handles ARGB color without alpha correctly', async () => {
    const iconValue = JSON.stringify({
      iconContent: '<svg><path d="M10"/></svg>',
      color: '#FF0000',
    });

    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          view: {
            name: 'Doc',
            icon: { ty: 2, value: iconValue },
          },
        },
      }),
    });

    const response = await createServer(makeRequest('/space/doc'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('link[rel="icon"]').attr('href')).toContain('data:image/svg+xml;base64,');
  });

  // Additional HTTP method tests
  it('returns 405 for PUT requests', async () => {
    const response = await createServer(makeRequest('/space/page', { method: 'PUT' }));

    expect(response.status).toBe(405);
  });

  it('returns 405 for DELETE requests', async () => {
    const response = await createServer(makeRequest('/space/page', { method: 'DELETE' }));

    expect(response.status).toBe(405);
  });

  it('returns 405 for PATCH requests', async () => {
    const response = await createServer(makeRequest('/space/page', { method: 'PATCH' }));

    expect(response.status).toBe(405);
  });

  // Content-Type header tests
  it('returns text/html Content-Type for marketing routes', async () => {
    const response = await createServer(makeRequest('/login'));

    expect(response.headers.get('Content-Type')).toBe('text/html');
  });

  it('returns text/html Content-Type for publish routes', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: 'Test' } },
      }),
    });

    const response = await createServer(makeRequest('/space/page'));

    expect(response.headers.get('Content-Type')).toBe('text/html');
  });

  // Canonical URL tests
  it('sets correct canonical URL for publish pages', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: 'Test' } },
      }),
    });

    const response = await createServer(makeRequest('/workspace/my-page'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('link[rel="canonical"]').attr('href')).toBe('https://appflowy.test/workspace/my-page');
  });

  // OG meta tags tests
  it('sets correct og:url for publish pages', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: 'Test' } },
      }),
    });

    const response = await createServer(makeRequest('/workspace/page'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('meta[property="og:url"]').attr('content')).toBe('https://appflowy.test/workspace/page');
  });

  it('sets og:site_name to AppFlowy', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: 'Test' } },
      }),
    });

    const response = await createServer(makeRequest('/workspace/page'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('meta[property="og:site_name"]').attr('content')).toBe('AppFlowy');
  });

  it('sets og:type to website', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: 'Test' } },
      }),
    });

    const response = await createServer(makeRequest('/workspace/page'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('meta[property="og:type"]').attr('content')).toBe('website');
  });

  // Twitter card tests
  it('sets twitter:card to summary_large_image', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: 'Test' } },
      }),
    });

    const response = await createServer(makeRequest('/workspace/page'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('meta[name="twitter:card"]').attr('content')).toBe('summary_large_image');
  });

  it('sets twitter:site to @appflowy', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: 'Test' } },
      }),
    });

    const response = await createServer(makeRequest('/workspace/page'));
    const html = await getHtml(response);
    const $ = load(html);

    expect($('meta[name="twitter:site"]').attr('content')).toBe('@appflowy');
  });

  // Edge case tests
  it('handles special characters in namespace', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    const response = await createServer(makeRequest('/test%2Fnamespace'));
    const html = await getHtml(response);

    expect(response.status).toBe(200);
    expect(html).toContain('NO_DEFAULT_PAGE');
  });

  it('handles emoji in publish name', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: '📝 My Notes' } },
      }),
    });

    const response = await createServer(makeRequest('/space/%F0%9F%93%9D-notes'));
    const html = await getHtml(response);
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('title').text()).toBe('📝 My Notes | AppFlowy');
  });

  it('handles very long page names', async () => {
    const longName = 'A'.repeat(200);

    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: longName } },
      }),
    });

    const response = await createServer(makeRequest('/space/page'));
    const html = await getHtml(response);
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('title').text()).toBe(`${longName} | AppFlowy`);
  });

  // API endpoint verification
  it('uses v1 API for publish page lookup', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { view: { name: 'Test' } },
      }),
    });

    await createServer(makeRequest('/myspace/mypage'));

    expect(mockBunFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/workspace/v1/published/myspace/mypage',
      { verbose: false }
    );
  });

  it('uses non-v1 API for namespace lookup', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    await createServer(makeRequest('/myspace'));

    expect(mockBunFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/workspace/published/myspace',
      { verbose: false }
    );
  });

  // NOTE: Static file handling tests are in routes.test.ts

  // Error message content tests
  it('includes user-friendly message for NO_DEFAULT_PAGE error', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    const response = await createServer(makeRequest('/space'));
    const html = await getHtml(response);

    expect(html).toContain("doesn't have a default published page");
  });

  it('includes user-friendly message for PUBLISH_VIEW_LOOKUP_FAILED error', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 404 }),
    });

    const response = await createServer(makeRequest('/space/page'));
    const html = await getHtml(response);

    expect(html).toContain("page you're looking for doesn't exist");
  });

  it('includes user-friendly message for FETCH_ERROR', async () => {
    mockBunFetch.mockRejectedValue(new Error('timeout'));

    const response = await createServer(makeRequest('/space/page'));
    const html = await getHtml(response);

    expect(html).toContain('Unable to load this page');
  });

  it('includes user-friendly message for UNKNOWN_FALLBACK', async () => {
    mockBunFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: null }),
    });

    const response = await createServer(makeRequest('/space/page'));
    const html = await getHtml(response);

    expect(html).toContain("couldn't load this page");
  });
});
