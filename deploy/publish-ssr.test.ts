/** @jest-environment node */

import { jest } from '@jest/globals';
import { load } from 'cheerio';

import {
  publishedDatabasePayload,
  publishedRichDocumentPayload,
  richDocumentChildViewId,
} from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';

import { clearViewRouteCache } from './publish-links';

const mockBunFetch = jest.fn<(url: string, init?: Record<string, unknown>) => Promise<unknown>>();

const htmlTemplate = `<!DOCTYPE html><html><head><title>AppFlowy</title><link rel="icon" href="/appflowy.ico"><link rel="canonical" href=""></head><body><div id="root"></div></body></html>`;

jest.mock('pino', () => () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: () => htmlTemplate,
}));

jest.mock(
  'bun',
  () => ({
    fetch: (url: string, init?: Record<string, unknown>) => mockBunFetch(url, init),
  }),
  { virtual: true }
);

const SSR_ENV_KEYS = [
  'APPFLOWY_SSR_KILL_SWITCH',
  'APPFLOWY_INDEXABLE_NAMESPACES',
  'APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS',
  'APPFLOWY_SSR_MAX_INLINE_BYTES',
];
const NOINDEX = 'noindex, nofollow, noarchive, nosnippet';

const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });

const metadata = (config?: unknown) => ({
  code: 0,
  data: {
    view: { name: 'Doc', icon: null, extra: null },
    child_views: [],
    ancestor_views: [],
    ...(config === undefined ? {} : { config }),
  },
});

type Upstream = {
  metadata?: () => Promise<unknown>;
  snapshot?: () => Promise<unknown>;
  viewInfo?: (url: string) => Promise<unknown>;
};

const NOT_PUBLISHED = () => json({ code: -2, message: 'Record not found' });

const snapshotOk = (snapshot: unknown = publishedRichDocumentPayload) => () => json({ code: 0, data: snapshot });

describe('published page SSR', () => {
  let createServer: typeof import('./server').createServer;
  let APP_PATHS: string[];

  const mockUpstream = ({
    metadata: meta = () => json(metadata()),
    snapshot = snapshotOk(),
    viewInfo = NOT_PUBLISHED,
  }: Upstream = {}) => {
    mockBunFetch.mockImplementation((url: string) => {
      if (url.endsWith('/snapshot')) return snapshot();
      if (url.includes('/published-info/')) return viewInfo(url);

      return meta();
    });
  };

  const viewInfoCalls = () => mockBunFetch.mock.calls.filter(([url]) => url.includes('/published-info/'));

  const request = (path: string) =>
    createServer(new Request(`https://appflowy.test${path}`, { headers: { host: 'appflowy.test' } }));

  const snapshotCalls = () => mockBunFetch.mock.calls.filter(([url]) => url.endsWith('/snapshot'));

  const inlinedSnapshot = (html: string) => {
    const script = load(html)('#appflowy-publish-snapshot').html();
    const match = script?.match(/^window\.__APPFLOWY_PUBLISH_SNAPSHOT__ = (.*);$/s);

    return match ? JSON.parse(match[1]) : undefined;
  };

  const expectShell = async (response: Response, robots: string | null = null) => {
    const html = await response.text();
    const $ = load(html);

    expect(response.status).toBe(200);
    expect($('#root').html()).toBe('');
    expect($('[data-appflowy-ssr]').length).toBe(0);
    expect($('#appflowy-publish-snapshot').length).toBe(0);
    expect($('#appflowy-ssr-style').length).toBe(0);
    expect(response.headers.get('X-Robots-Tag')).toBe(robots);
    expect($('meta[name="robots"]').attr('content')).toBe(robots ?? undefined);

    return html;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APPFLOWY_BASE_URL = 'https://api.example.com';
    ({ createServer } = await import('./server'));
    ({ APP_PATHS } = await import('./app-paths'));
  });

  beforeEach(() => {
    mockBunFetch.mockReset();
    clearViewRouteCache();
    SSR_ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  afterAll(() => {
    SSR_ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  describe('default mode (no configuration)', () => {
    it('serves the shell and never requests the snapshot', async () => {
      mockUpstream();

      await expectShell(await request('/docs/page'));
      expect(snapshotCalls()).toHaveLength(0);
      expect(mockBunFetch).toHaveBeenCalledTimes(1);
    });

    it('ignores a malformed publisher flag', async () => {
      mockUpstream({ metadata: () => json(metadata({ indexing_enabled: 'true' })) });

      await expectShell(await request('/docs/page'));
      expect(snapshotCalls()).toHaveLength(0);
    });
  });

  describe('ssr-indexable via namespace allowlist', () => {
    beforeEach(() => {
      process.env.APPFLOWY_INDEXABLE_NAMESPACES = 'docs,guide';
    });

    it('renders the body, inlines the snapshot and sends no robots directive', async () => {
      mockUpstream();

      const response = await request('/docs/page');
      const html = await response.text();
      const $ = load(html);

      expect(response.headers.get('X-Robots-Tag')).toBeNull();
      expect($('meta[name="robots"]').length).toBe(0);
      expect($('#root > article[data-appflowy-ssr] > h1').text()).toBe('Rich document');
      expect($('#root').text()).toContain('Cell A1');
      expect($('#appflowy-ssr-style').length).toBe(1);
      expect(inlinedSnapshot(html)).toEqual(publishedRichDocumentPayload);
      // Head metadata is still produced as before.
      expect($('title').text()).toBe('Doc | AppFlowy');
    });

    it('fetches the snapshot anonymously from the v2 published endpoint', async () => {
      mockUpstream();

      await request('/docs/my%20page');

      const [url, init] = snapshotCalls()[0];

      expect(url).toBe('https://api.example.com/api/workspace/v2/published/docs/my%20page/snapshot');
      expect(init).not.toHaveProperty('headers');
    });

    it('does not apply to namespaces outside the allowlist', async () => {
      mockUpstream();

      await expectShell(await request('/customer/page'));
      expect(snapshotCalls()).toHaveLength(0);
    });

    it('keeps the body but skips inlining when the snapshot is over the size limit', async () => {
      process.env.APPFLOWY_SSR_MAX_INLINE_BYTES = '10';
      mockUpstream();

      const html = await (await request('/docs/page')).text();

      expect(load(html)('[data-appflowy-ssr]').length).toBe(1);
      expect(load(html)('#appflowy-publish-snapshot').length).toBe(0);
    });

    it('leaves namespace-only redirects unchanged', async () => {
      mockUpstream({ metadata: () => json({ code: 0, data: { info: { namespace: 'docs', publish_name: 'home' } } }) });

      const response = await request('/docs');

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/docs/home');
      expect(snapshotCalls()).toHaveLength(0);
    });

    it('serves the normal error page when the metadata lookup fails', async () => {
      mockUpstream({ metadata: () => json({ code: 1024 }) });

      const html = await expectShell(await request('/docs/missing'));

      expect(load(html)('#appflowy-publish-error').length).toBe(1);
    });
  });

  describe('links to other published pages', () => {
    const childInfo = (namespace: string, publishName = 'child-page') => () =>
      json({
        code: 0,
        data: {
          namespace,
          publish_name: publishName,
          view_id: richDocumentChildViewId,
          publisher_email: 'someone@example.com',
          unpublished_timestamp: null,
        },
      });

    beforeEach(() => {
      process.env.APPFLOWY_INDEXABLE_NAMESPACES = 'docs,guide';
    });

    it('links sub-pages and page mentions in the same namespace', async () => {
      mockUpstream({ viewInfo: childInfo('docs') });

      const html = await (await request('/docs/page')).text();
      const links = load(html)('#root a[href="/docs/child-page"]');

      // The rich fixture has a sub-page block and a page mention to the same child.
      expect(links.length).toBe(2);
      expect(links.first().text()).toBe('Child page');
      expect(html).not.toContain('someone@example.com');
      expect(viewInfoCalls().map(([url, init]) => [url, init && 'headers' in init])).toEqual([
        [`https://api.example.com/api/workspace/v1/published-info/${richDocumentChildViewId}`, false],
      ]);
    });

    it('links targets in another allowlisted namespace', async () => {
      mockUpstream({ viewInfo: childInfo('guide') });

      const html = await (await request('/docs/page')).text();

      expect(load(html)('#root a[href="/guide/child-page"]').length).toBe(2);
    });

    it('does not link targets in a namespace that is not allowlisted', async () => {
      mockUpstream({ viewInfo: childInfo('customer') });

      const html = await (await request('/docs/page')).text();
      const $ = load(html);

      expect($('#root a[href^="/customer"]').length).toBe(0);
      expect($('#root').text()).toContain('Child page');
    });

    it.each([
      ['not published', NOT_PUBLISHED],
      ['HTTP 500', () => json({}, false)],
      ['network error', () => Promise.reject(new Error('down'))],
      ['unpublished timestamp set', () => json({ code: 0, data: { namespace: 'docs', publish_name: 'x', unpublished_timestamp: 't' } })],
    ])('renders the name without a link when the lookup is %s', async (_label, viewInfo) => {
      mockUpstream({ viewInfo });

      const html = await (await request('/docs/page')).text();
      const $ = load(html);

      expect($('[data-appflowy-ssr]').length).toBe(1);
      expect($('#root p').filter((_, el) => $(el).text() === 'Child page').length).toBe(1);
      expect($('#root a[href^="/docs/child"]').length).toBe(0);
    });

    it('a slow lookup does not hold the page past the deadline', async () => {
      process.env.APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS = '100';
      mockUpstream({ viewInfo: () => new Promise(() => undefined) });

      const started = Date.now();
      const html = await (await request('/docs/page')).text();

      expect(load(html)('[data-appflowy-ssr]').length).toBe(1);
      expect(Date.now() - started).toBeLessThan(2000);
    });
  });

  describe('publisher flag (rules 2 and 3)', () => {
    it('opt-out beats the allowlist: shell with noindex header and meta', async () => {
      process.env.APPFLOWY_INDEXABLE_NAMESPACES = 'docs';
      mockUpstream({ metadata: () => json(metadata({ indexing_enabled: false })) });

      await expectShell(await request('/docs/page'), NOINDEX);
    });

    it('opt-in renders a page outside the allowlist, fetching the snapshot after metadata', async () => {
      mockUpstream({ metadata: () => json(metadata({ indexing_enabled: true })) });

      const response = await request('/customer/page');
      const html = await response.text();

      expect(load(html)('[data-appflowy-ssr]').length).toBe(1);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
      expect(
        mockBunFetch.mock.calls.map(([url]) => url).filter((url) => !url.includes('/published-info/'))
      ).toEqual([
        'https://api.example.com/api/workspace/v1/published/customer/page',
        'https://api.example.com/api/workspace/v2/published/customer/page/snapshot',
      ]);
      // Link lookups happen only after the snapshot arrives.
      expect(viewInfoCalls()).toHaveLength(1);
    });
  });

  describe('kill switch', () => {
    it('returns the exact default response even with the allowlist and an opt-in set', async () => {
      mockUpstream();
      const baseline = await (await request('/docs/page')).text();

      process.env.APPFLOWY_INDEXABLE_NAMESPACES = 'docs';
      process.env.APPFLOWY_SSR_KILL_SWITCH = 'true';
      mockBunFetch.mockReset();
      mockUpstream({ metadata: () => json(metadata({ indexing_enabled: true })) });

      const killed = await expectShell(await request('/docs/page'));

      expect(killed).toBe(baseline);
      expect(snapshotCalls()).toHaveLength(0);
    });
  });

  describe('failures degrade to the shell', () => {
    beforeEach(() => {
      process.env.APPFLOWY_INDEXABLE_NAMESPACES = 'docs';
    });

    it.each([
      ['network error', () => Promise.reject(new Error('down'))],
      ['HTTP 500', () => json({}, false)],
      ['API error code', () => json({ code: 1024, message: 'nope' })],
      ['invalid JSON', () => Promise.resolve({ ok: true, json: async () => JSON.parse('{') })],
      ['null data', () => json({ code: 0, data: null })],
      ['database snapshot', snapshotOk(publishedDatabasePayload)],
      ['unknown schema version', snapshotOk({ ...publishedRichDocumentPayload, schemaVersion: 2 })],
    ])('%s', async (_label, snapshot) => {
      mockUpstream({ snapshot });

      await expectShell(await request('/docs/page'));
    });

    it('a snapshot that never arrives times out', async () => {
      process.env.APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS = '100';
      mockUpstream({ snapshot: () => new Promise(() => undefined) });

      const started = Date.now();

      await expectShell(await request('/docs/page'));
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('an opted-in page whose snapshot fails serves the plain shell', async () => {
      process.env.APPFLOWY_INDEXABLE_NAMESPACES = '';
      mockUpstream({
        metadata: () => json(metadata({ indexing_enabled: true })),
        snapshot: () => json({}, false),
      });

      await expectShell(await request('/customer/page'));
    });
  });

  describe('authenticated app paths never reach SSR', () => {
    const appNamespaces = () => APP_PATHS.map((appPath) => appPath.slice(1));

    it.each([
      '/after-payment',
      '/login',
      '/auth',
      '/as-template',
      '/app',
      '/accept-invitation',
      '/import',
    ])('%s and its sub-paths serve the bare app shell', async (appPath) => {
      // Worst case: every app namespace allowlisted and upstream claiming opt-in.
      process.env.APPFLOWY_INDEXABLE_NAMESPACES = appNamespaces().join(',');
      mockUpstream({ metadata: () => json(metadata({ indexing_enabled: true })) });

      for (const path of [appPath, `${appPath}/workspace-id/view-id`, `${appPath}/x`]) {
        const html = await (await request(path)).text();

        expect(load(html)('[data-appflowy-ssr]').length).toBe(0);
        expect(load(html)('#appflowy-publish-snapshot').length).toBe(0);
      }

      expect(mockBunFetch).not.toHaveBeenCalled();
    });

    it('covers every entry of APP_PATHS', () => {
      expect(APP_PATHS).toEqual([
        '/after-payment',
        '/login',
        '/auth',
        '/as-template',
        '/app',
        '/accept-invitation',
        '/import',
      ]);
    });
  });

  describe('injection through the snapshot', () => {
    it('cannot break out of the inlined script or the body', async () => {
      process.env.APPFLOWY_INDEXABLE_NAMESPACES = 'docs';

      const hostile = {
        ...publishedRichDocumentPayload,
        view: { ...publishedRichDocumentPayload.view, name: '</script><script>alert(1)</script>' },
      };

      mockUpstream({ snapshot: snapshotOk(hostile) });

      const html = await (await request('/docs/page')).text();
      const $ = load(html);

      // Only the scripts we emit, none injected.
      expect($('script').length).toBe(1);
      expect($('#root h1').text()).toBe('</script><script>alert(1)</script>');
      expect(inlinedSnapshot(html).view.name).toBe(hostile.view.name);
    });
  });
});

describe('renderPublishPage ssr-noindex support', () => {
  // No input produces ssr-noindex yet, so the renderer's handling is tested
  // directly: body rendered and the robots meta present together.
  it('renders the body together with the noindex meta', async () => {
    const { renderPublishPage } = await import('./html');
    const html = renderPublishPage({
      hostname: 'appflowy.test',
      pathname: '/docs/page',
      ssr: { bodyHtml: '<article data-appflowy-ssr><p>x</p></article>' },
      robots: NOINDEX,
    });
    const $ = load(html);

    expect($('#root [data-appflowy-ssr] p').text()).toBe('x');
    expect($('meta[name="robots"]').attr('content')).toBe(NOINDEX);
    expect($('#appflowy-publish-snapshot').length).toBe(0);
  });
});
