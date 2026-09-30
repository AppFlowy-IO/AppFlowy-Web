/** @jest-environment node */

/**
 * Golden (characterization) test for published-page responses.
 *
 * The SSR rollout rests on one safety property: with no SSR environment
 * configuration, every published page must be served exactly as it was before
 * SSR existed — same status, same headers, same bytes. Customers published
 * pages under that behaviour, so nothing about it may change until someone
 * explicitly opts in.
 *
 * The golden files under `__golden__/` were recorded from the pre-SSR
 * implementation. Do not regenerate them to make a failing test pass: a diff
 * here means default behaviour changed. Regenerate (`UPDATE_GOLDEN=1`) only for
 * a deliberate, reviewed change to the default response.
 */

import { jest } from '@jest/globals';
import path from 'path';

const actualFs = jest.requireActual<typeof import('fs')>('fs');
const mockBunFetch = jest.fn();

// The real Vite entry HTML, so the golden output reflects the production template.
const indexTemplate = actualFs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

jest.mock('pino', () => () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: () => indexTemplate,
}));

jest.mock(
  'bun',
  () => ({
    fetch: (...args: unknown[]) => mockBunFetch(...args),
  }),
  { virtual: true }
);

const GOLDEN_DIR = path.join(__dirname, '__golden__');
const SSR_ENV_KEYS = [
  'APPFLOWY_SSR_KILL_SWITCH',
  'APPFLOWY_INDEXABLE_NAMESPACES',
  'APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS',
  'APPFLOWY_SSR_MAX_INLINE_BYTES',
];

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

type Scenario = {
  name: string;
  path: string;
  mockFetch: () => void;
};

const scenarios: Scenario[] = [
  {
    name: 'publish-page-success',
    path: '/space/doc',
    mockFetch: () =>
      mockBunFetch.mockResolvedValue(
        okJson({
          code: 0,
          data: {
            view: {
              name: 'Getting Started',
              icon: { ty: 0, value: '😀' },
              extra: JSON.stringify({ cover: { type: 'built_in', value: '3' } }),
            },
            child_views: [],
            ancestor_views: [],
          },
        })
      ),
  },
  {
    name: 'publish-page-custom-icon',
    path: '/space/icon-doc',
    mockFetch: () =>
      mockBunFetch.mockResolvedValue(
        okJson({
          code: 0,
          data: {
            view: {
              name: 'Icon Doc',
              icon: { ty: 2, value: JSON.stringify({ iconContent: '<svg fill="red"></svg>', color: '0xFF00FF00' }) },
              extra: null,
            },
          },
        })
      ),
  },
  {
    name: 'publish-page-lookup-failed',
    path: '/space/missing',
    mockFetch: () => mockBunFetch.mockResolvedValue(okJson({ code: 1024, message: 'not found' })),
  },
  {
    name: 'publish-page-http-error',
    path: '/space/broken',
    mockFetch: () => mockBunFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }),
  },
  {
    name: 'publish-page-fetch-rejected',
    path: '/space/offline',
    mockFetch: () => mockBunFetch.mockRejectedValue(new Error('network down')),
  },
  {
    name: 'namespace-without-default-page',
    path: '/space',
    mockFetch: () => mockBunFetch.mockResolvedValue(okJson({ code: 0, data: {} })),
  },
  {
    name: 'namespace-redirect',
    path: '/space',
    mockFetch: () =>
      mockBunFetch.mockResolvedValue(
        okJson({ code: 0, data: { info: { namespace: 'space', publish_name: 'home page' } } })
      ),
  },
];

// Headers are compared as a sorted "name: value" list so ordering in the
// Headers object cannot cause false failures, while any added, removed or
// changed header (e.g. an X-Robots-Tag) still does.
const serializeResponse = async (response: Response) => {
  const headers = Array.from(response.headers.entries())
    .map(([key, value]) => `${key}: ${value}`)
    .sort()
    .join('\n');

  return `status: ${response.status}\n${headers}\n\n${await response.text()}`;
};

describe('published page responses are unchanged by default (golden)', () => {
  let createServer: typeof import('./server').createServer;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APPFLOWY_BASE_URL = 'https://api.example.com';
    SSR_ENV_KEYS.forEach((key) => delete process.env[key]);

    const globalAny = global as typeof globalThis & { btoa?: (value: string) => string };

    if (!globalAny.btoa) {
      globalAny.btoa = (value: string) => Buffer.from(value, 'binary').toString('base64');
    }

    ({ createServer } = await import('./server'));
  });

  beforeEach(() => {
    mockBunFetch.mockReset();
  });

  it.each(scenarios)('$name matches the recorded pre-SSR response', async ({ name, path: requestPath, mockFetch }) => {
    mockFetch();

    const request = new Request(`https://appflowy.test${requestPath}`, {
      headers: { host: 'appflowy.test' },
    });
    const actual = await serializeResponse(await createServer(request));
    const goldenPath = path.join(GOLDEN_DIR, `${name}.txt`);

    if (process.env.UPDATE_GOLDEN === '1') {
      actualFs.mkdirSync(GOLDEN_DIR, { recursive: true });
      actualFs.writeFileSync(goldenPath, actual);
    }

    expect(actual).toBe(actualFs.readFileSync(goldenPath, 'utf8'));
    // Default mode must never reach the snapshot endpoint.
    expect(mockBunFetch.mock.calls.map(([url]) => String(url)).some((url) => url.endsWith('/snapshot'))).toBe(false);
  });
});
