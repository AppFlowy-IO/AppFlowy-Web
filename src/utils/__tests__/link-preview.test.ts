import axios from 'axios';

import {
  buildFallbackLinkPreviewData,
  clearLinkPreviewDataCache,
  fetchLinkPreviewData,
  getLinkPreviewProviders,
  parseGitHubPreviewTarget,
  registerLinkPreviewProvider,
} from '../link-preview';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('link preview providers', () => {
  const cleanupCallbacks: Array<() => void> = [];

  afterEach(() => {
    cleanupCallbacks.splice(0).forEach((cleanup) => cleanup());
    clearLinkPreviewDataCache();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockedAxios.isCancel.mockReturnValue(false);
  });

  it('builds a readable fallback for any URL', () => {
    expect(buildFallbackLinkPreviewData('https://example.com/docs/getting-started?tab=web')).toEqual({
      title: 'example.com/docs/getting-started',
      description: '',
    });
  });

  it('uses generic metadata when the universal provider succeeds', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        statusCode: 200,
        data: {
          title: 'Example title',
          description: 'Example description',
          image: { url: 'https://example.com/image.png' },
          logo: { url: 'https://example.com/logo.png' },
        },
      },
    });

    await expect(fetchLinkPreviewData('https://example.com/article')).resolves.toEqual({
      title: 'Example title',
      description: 'Example description',
      image: { url: 'https://example.com/image.png' },
      logo: { url: 'https://example.com/logo.png' },
    });

    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.microlink.io/', {
      params: { url: 'https://example.com/article' },
      signal: undefined,
      timeout: 10000,
    });
  });

  it('falls through to the deterministic URL fallback when providers fail', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('metadata provider unavailable'));

    await expect(fetchLinkPreviewData('https://example.com/articles/123')).resolves.toEqual({
      title: 'example.com/articles/123',
      description: '',
    });
  });

  it('dedupes concurrent requests for the same normalized URL', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        statusCode: 200,
        data: {
          title: 'Cached title',
          description: 'Cached description',
        },
      },
    });

    const [first, second] = await Promise.all([
      fetchLinkPreviewData('https://example.com/cached'),
      fetchLinkPreviewData('https://example.com/cached'),
    ]);

    expect(first).toEqual({
      title: 'Cached title',
      description: 'Cached description',
    });
    expect(second).toEqual(first);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('returns cached metadata for repeated requests', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        statusCode: 200,
        data: {
          title: 'Stored title',
          description: 'Stored description',
        },
      },
    });

    await expect(fetchLinkPreviewData('https://example.com/stored')).resolves.toEqual({
      title: 'Stored title',
      description: 'Stored description',
    });
    await expect(fetchLinkPreviewData('https://example.com/stored')).resolves.toEqual({
      title: 'Stored title',
      description: 'Stored description',
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('expires cached metadata after the cache ttl', async () => {
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        statusCode: 200,
        data: {
          title: 'Initial title',
          description: 'Initial description',
        },
      },
    });

    await expect(fetchLinkPreviewData('https://example.com/ttl')).resolves.toEqual({
      title: 'Initial title',
      description: 'Initial description',
    });

    nowSpy.mockReturnValue(11 * 60 * 1_000);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        statusCode: 200,
        data: {
          title: 'Refetched title',
          description: 'Refetched description',
        },
      },
    });

    await expect(fetchLinkPreviewData('https://example.com/ttl')).resolves.toEqual({
      title: 'Refetched title',
      description: 'Refetched description',
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('evicts the least recently used metadata when the cache reaches its size limit', async () => {
    let fetchCount = 0;
    const cleanup = registerLinkPreviewProvider({
      id: 'bounded-cache-provider',
      canHandle: ({ parsedUrl }) => parsedUrl?.hostname === 'cache.example',
      async fetch({ parsedUrl }) {
        fetchCount += 1;
        return {
          title: parsedUrl?.pathname || 'cache',
          description: 'cache entry',
        };
      },
    });

    cleanupCallbacks.push(cleanup);

    for (let index = 0; index < 201; index += 1) {
      await fetchLinkPreviewData(`https://cache.example/${index}`);
    }

    expect(fetchCount).toBe(201);
    await expect(fetchLinkPreviewData('https://cache.example/0')).resolves.toEqual({
      title: '/0',
      description: 'cache entry',
    });
    expect(fetchCount).toBe(202);
  });

  it('invalidates cached metadata when providers are registered', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        statusCode: 200,
        data: {
          title: 'Generic title',
          description: 'Generic description',
        },
      },
    });

    await expect(fetchLinkPreviewData('https://example.com/provider-cache')).resolves.toEqual({
      title: 'Generic title',
      description: 'Generic description',
    });
    mockedAxios.get.mockClear();

    const cleanup = registerLinkPreviewProvider({
      id: 'example-provider',
      canHandle: ({ parsedUrl }) => parsedUrl?.hostname === 'example.com',
      async fetch() {
        return {
          title: 'Provider title',
          description: 'Provider description',
        };
      },
    });

    cleanupCallbacks.push(cleanup);

    await expect(fetchLinkPreviewData('https://example.com/provider-cache')).resolves.toEqual({
      title: 'Provider title',
      description: 'Provider description',
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('uses provider order deterministically within the same priority group', async () => {
    let resolveSlowProvider: ((data: { description: string; title: string }) => void) | undefined;
    const slowProviderPromise = new Promise<{ description: string; title: string }>((resolve) => {
      resolveSlowProvider = resolve;
    });

    const cleanupFast = registerLinkPreviewProvider({
      id: 'fast-provider',
      priority: 25,
      canHandle: ({ parsedUrl }) => parsedUrl?.hostname === 'priority.example',
      async fetch() {
        return {
          title: 'Fast title',
          description: 'Fast description',
        };
      },
    });
    const cleanupSlow = registerLinkPreviewProvider({
      id: 'slow-provider',
      priority: 25,
      canHandle: ({ parsedUrl }) => parsedUrl?.hostname === 'priority.example',
      fetch: () => slowProviderPromise,
    });

    cleanupCallbacks.push(cleanupSlow, cleanupFast);

    const request = fetchLinkPreviewData('https://priority.example/file');
    let settled = false;

    void request.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSlowProvider?.({
      title: 'Slow title',
      description: 'Slow description',
    });

    await expect(request).resolves.toEqual({
      title: 'Slow title',
      description: 'Slow description',
    });
  });

  it('can be extended with a custom provider without changing the preview component', async () => {
    const cleanup = registerLinkPreviewProvider({
      id: 'figma',
      canHandle: ({ parsedUrl }) => parsedUrl?.hostname === 'www.figma.com',
      async fetch() {
        return {
          title: 'Figma file',
          description: 'A design preview from a custom provider',
          image: { url: 'https://figma.example/preview.png' },
        };
      },
    });

    cleanupCallbacks.push(cleanup);

    await expect(fetchLinkPreviewData('https://www.figma.com/file/abc/AppFlowy')).resolves.toEqual({
      title: 'Figma file',
      description: 'A design preview from a custom provider',
      image: { url: 'https://figma.example/preview.png' },
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('prefers universal metadata for GitHub URLs so page preview images are preserved', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        statusCode: 200,
        data: {
          title: 'Issue title from metadata',
          description: 'Issue description from metadata',
          image: { url: 'https://opengraph.githubassets.com/hash/AppFlowy-IO/AppFlowy-Web/issues/53' },
        },
      },
    });

    await expect(fetchLinkPreviewData('https://github.com/AppFlowy-IO/AppFlowy-Web/issues/53')).resolves.toEqual({
      title: 'Issue title from metadata',
      description: 'Issue description from metadata',
      image: { url: 'https://opengraph.githubassets.com/hash/AppFlowy-IO/AppFlowy-Web/issues/53' },
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.microlink.io/', {
      params: { url: 'https://github.com/AppFlowy-IO/AppFlowy-Web/issues/53' },
      signal: undefined,
      timeout: 10000,
    });
  });

  it('falls back to the GitHub API when universal metadata is unavailable', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('metadata provider unavailable'));
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        body: 'Issue body',
        html_url: 'https://github.com/AppFlowy-IO/AppFlowy-Web/issues/53',
        number: 53,
        title: 'Issue title',
        user: {
          avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        },
      },
    });

    await expect(fetchLinkPreviewData('https://github.com/AppFlowy-IO/AppFlowy-Web/issues/53')).resolves.toEqual({
      title: 'Issue title - AppFlowy-IO/AppFlowy-Web#53',
      description: 'Issue body',
      image: { url: 'https://avatars.githubusercontent.com/u/1?v=4' },
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.get).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/AppFlowy-IO/AppFlowy-Web/issues/53',
      {
        headers: {
          Accept: 'application/vnd.github+json',
        },
        signal: undefined,
        timeout: 10000,
      }
    );
  });

  it('keeps default providers available after custom providers', () => {
    const cleanup = registerLinkPreviewProvider({
      id: 'custom-noop',
      canHandle: () => false,
      async fetch() {
        return undefined;
      },
    });

    cleanupCallbacks.push(cleanup);

    expect(getLinkPreviewProviders().map((provider) => provider.id)).toEqual([
      'custom-noop',
      'microlink',
      'github',
      'url-fallback',
    ]);
  });

  it('supports priority placement for custom providers', () => {
    const cleanup = registerLinkPreviewProvider({
      id: 'late-custom',
      priority: 150,
      canHandle: () => false,
      async fetch() {
        return undefined;
      },
    });

    cleanupCallbacks.push(cleanup);

    expect(getLinkPreviewProviders().map((provider) => provider.id)).toEqual([
      'microlink',
      'github',
      'late-custom',
      'url-fallback',
    ]);
  });

  it('parses GitHub repository, issue, and pull request URLs for provider-specific fallback', () => {
    expect(parseGitHubPreviewTarget('https://github.com/AppFlowy-IO/AppFlowy-Web')).toEqual({
      owner: 'AppFlowy-IO',
      repo: 'AppFlowy-Web',
      kind: 'repo',
    });
    expect(parseGitHubPreviewTarget('https://github.com/AppFlowy-IO/AppFlowy-Web/issues/53')).toEqual({
      owner: 'AppFlowy-IO',
      repo: 'AppFlowy-Web',
      kind: 'issue',
      number: '53',
    });
    expect(parseGitHubPreviewTarget('https://github.com/AppFlowy-IO/AppFlowy-Web/pull/100')).toEqual({
      owner: 'AppFlowy-IO',
      repo: 'AppFlowy-Web',
      kind: 'pull',
      number: '100',
    });
  });
});
