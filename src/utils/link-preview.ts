import axios from 'axios';

import { processUrl } from '@/utils/url';

const LINK_PREVIEW_REQUEST_TIMEOUT = 10_000;
const DESCRIPTION_MAX_LENGTH = 240;
const LINK_PREVIEW_CACHE_TTL = 10 * 60 * 1000;
const LINK_PREVIEW_CACHE_MAX_ENTRIES = 200;
const DEFAULT_CUSTOM_PROVIDER_PRIORITY = 50;
const UNIVERSAL_PROVIDER_PRIORITY = 100;
const DOMAIN_PROVIDER_PRIORITY = 110;
const FALLBACK_PROVIDER_PRIORITY = 1000;

export interface LinkPreviewImageData {
  url: string;
}

export interface LinkPreviewData {
  image?: LinkPreviewImageData;
  logo?: LinkPreviewImageData;
  // Favicon variant for dark themes (e.g. GitHub's light octocat), used when the
  // default favicon is a near-black monochrome icon that vanishes on dark UI.
  logoDark?: LinkPreviewImageData;
  title: string;
  description: string;
  siteName?: string;
}

export interface LinkPreviewProviderContext {
  fallbackData: LinkPreviewData;
  normalizedUrl: string;
  parsedUrl?: URL;
  signal?: AbortSignal;
}

export interface LinkPreviewProvider {
  id: string;
  priority?: number;
  canHandle: (context: LinkPreviewProviderContext) => boolean;
  fetch: (context: LinkPreviewProviderContext) => Promise<LinkPreviewData | undefined>;
}

interface MicrolinkResponse {
  statusCode?: number;
  data?: {
    image?: LinkPreviewImageData | null;
    logo?: LinkPreviewImageData | null;
    title?: string | null;
    description?: string | null;
  };
}

interface GitHubIssueResponse {
  body?: string | null;
  html_url?: string;
  number?: number;
  pull_request?: unknown;
  title?: string;
  user?: {
    avatar_url?: string;
  } | null;
}

interface GitHubRepositoryResponse {
  description?: string | null;
  full_name?: string;
  html_url?: string;
  owner?: {
    avatar_url?: string;
  } | null;
}

interface GitHubPreviewTarget {
  owner: string;
  repo: string;
  kind: 'issue' | 'pull' | 'repo';
  number?: string;
}

interface LinkPreviewCacheEntry {
  data: LinkPreviewData;
  expiresAt: number;
}

const customLinkPreviewProviders: LinkPreviewProvider[] = [];
const linkPreviewDataCache = new Map<string, LinkPreviewCacheEntry>();
const inFlightLinkPreviewRequests = new Map<string, Promise<LinkPreviewData>>();
let providerRegistryVersion = 0;

const microlinkProvider: LinkPreviewProvider = {
  id: 'microlink',
  priority: UNIVERSAL_PROVIDER_PRIORITY,
  canHandle: () => true,
  async fetch(context) {
    const response = await axios.get<MicrolinkResponse>('https://api.microlink.io/', {
      params: { url: context.normalizedUrl },
      signal: context.signal,
      timeout: LINK_PREVIEW_REQUEST_TIMEOUT,
    });

    const payload = response.data;

    if (!payload.data || (payload.statusCode !== undefined && payload.statusCode >= 400)) {
      return undefined;
    }

    return normalizePreviewData(payload.data, context.fallbackData);
  },
};

const githubProvider: LinkPreviewProvider = {
  id: 'github',
  priority: DOMAIN_PROVIDER_PRIORITY,
  canHandle: (context) => Boolean(parseGitHubPreviewTarget(context)),
  async fetch(context) {
    const target = parseGitHubPreviewTarget(context);

    if (!target) return undefined;

    const requestConfig = {
      headers: {
        Accept: 'application/vnd.github+json',
      },
      signal: context.signal,
      timeout: LINK_PREVIEW_REQUEST_TIMEOUT,
    };

    if ((target.kind === 'issue' || target.kind === 'pull') && target.number) {
      const response = await axios.get<GitHubIssueResponse>(
        `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/${
          target.number
        }`,
        requestConfig
      );
      const issue = response.data;
      const type = issue.pull_request ? 'Pull request' : 'Issue';
      const title = issue.title
        ? `${issue.title} - ${target.owner}/${target.repo}#${target.number}`
        : `${type} #${target.number} - ${target.owner}/${target.repo}`;
      const description = truncateDescription(cleanupGitHubText(issue.body) || issue.html_url || '');

      return {
        title,
        description,
        siteName: 'GitHub',
        ...(issue.user?.avatar_url ? { image: { url: issue.user.avatar_url } } : {}),
      };
    }

    const response = await axios.get<GitHubRepositoryResponse>(
      `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`,
      requestConfig
    );
    const repository = response.data;

    return {
      title: repository.full_name || `${target.owner}/${target.repo}`,
      description: truncateDescription(repository.description || repository.html_url || ''),
      siteName: 'GitHub',
      ...(repository.owner?.avatar_url ? { image: { url: repository.owner.avatar_url } } : {}),
    };
  },
};

const fallbackProvider: LinkPreviewProvider = {
  id: 'url-fallback',
  priority: FALLBACK_PROVIDER_PRIORITY,
  canHandle: () => true,
  async fetch(context) {
    return context.fallbackData;
  },
};

const defaultLinkPreviewProviders: LinkPreviewProvider[] = [microlinkProvider, githubProvider, fallbackProvider];

export function registerLinkPreviewProvider(provider: LinkPreviewProvider): () => void {
  const existingIndex = customLinkPreviewProviders.findIndex((item) => item.id === provider.id);

  if (existingIndex >= 0) {
    customLinkPreviewProviders.splice(existingIndex, 1, provider);
  } else {
    customLinkPreviewProviders.unshift(provider);
  }

  invalidateLinkPreviewCache();

  return () => {
    const currentIndex = customLinkPreviewProviders.findIndex((item) => item.id === provider.id);

    if (currentIndex >= 0 && customLinkPreviewProviders[currentIndex] === provider) {
      customLinkPreviewProviders.splice(currentIndex, 1);
      invalidateLinkPreviewCache();
    }
  };
}

export function getLinkPreviewProviders(): LinkPreviewProvider[] {
  return [
    ...customLinkPreviewProviders.map((provider, index) => ({
      provider,
      priority: provider.priority ?? DEFAULT_CUSTOM_PROVIDER_PRIORITY,
      index,
    })),
    ...defaultLinkPreviewProviders.map((provider, index) => ({
      provider,
      priority: provider.priority ?? FALLBACK_PROVIDER_PRIORITY,
      index: customLinkPreviewProviders.length + index,
    })),
  ]
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ provider }) => provider);
}

export function clearLinkPreviewDataCache() {
  linkPreviewDataCache.clear();
  inFlightLinkPreviewRequests.clear();
}

function invalidateLinkPreviewCache() {
  providerRegistryVersion += 1;
  clearLinkPreviewDataCache();
}

export function buildFallbackLinkPreviewData(url: string): LinkPreviewData {
  const normalizedUrl = processUrl(url) || url;

  try {
    const parsed = new URL(normalizedUrl);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map(safeDecodeURIComponent)
      .join('/');

    return {
      title: path ? `${host}/${path}` : host || normalizedUrl,
      description: '',
    };
  } catch {
    return {
      title: url,
      description: '',
    };
  }
}

export async function fetchLinkPreviewData(url: string, signal?: AbortSignal): Promise<LinkPreviewData> {
  const normalizedUrl = processUrl(url) || url;
  const cacheKey = getLinkPreviewCacheKey(normalizedUrl);
  const cachedData = getCachedLinkPreviewData(cacheKey);

  if (cachedData) return cachedData;

  let request = inFlightLinkPreviewRequests.get(cacheKey);

  if (!request) {
    const registryVersion = providerRegistryVersion;

    request = fetchLinkPreviewDataFromProviders(normalizedUrl)
      .then((data) => {
        if (registryVersion === providerRegistryVersion) {
          setCachedLinkPreviewData(cacheKey, data);
        }

        return data;
      })
      .finally(() => {
        inFlightLinkPreviewRequests.delete(cacheKey);
      });
    inFlightLinkPreviewRequests.set(cacheKey, request);
  }

  return signal ? raceWithAbortSignal(request, signal) : request;
}

async function fetchLinkPreviewDataFromProviders(normalizedUrl: string): Promise<LinkPreviewData> {
  const context: LinkPreviewProviderContext = {
    normalizedUrl,
    fallbackData: buildFallbackLinkPreviewData(normalizedUrl),
    parsedUrl: parseUrl(normalizedUrl),
  };

  for (const providers of getProviderGroups(context)) {
    const data = await fetchFirstSuccessfulProviderData(providers, context);

    if (data) return data;
  }

  return context.fallbackData;
}

function getProviderGroups(context: LinkPreviewProviderContext): LinkPreviewProvider[][] {
  const groups: LinkPreviewProvider[][] = [];
  let currentPriority: number | undefined;

  for (const provider of getLinkPreviewProviders()) {
    if (!provider.canHandle(context)) continue;

    const priority = provider.priority ?? FALLBACK_PROVIDER_PRIORITY;

    if (currentPriority !== priority) {
      groups.push([]);
      currentPriority = priority;
    }

    groups[groups.length - 1].push(provider);
  }

  return groups;
}

function getLinkPreviewCacheKey(normalizedUrl: string): string {
  return `${providerRegistryVersion}:${normalizedUrl}`;
}

function getCachedLinkPreviewData(cacheKey: string): LinkPreviewData | undefined {
  const entry = linkPreviewDataCache.get(cacheKey);

  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    linkPreviewDataCache.delete(cacheKey);
    return undefined;
  }

  linkPreviewDataCache.delete(cacheKey);
  linkPreviewDataCache.set(cacheKey, entry);
  return entry.data;
}

function setCachedLinkPreviewData(cacheKey: string, data: LinkPreviewData) {
  if (linkPreviewDataCache.has(cacheKey)) {
    linkPreviewDataCache.delete(cacheKey);
  }

  linkPreviewDataCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + LINK_PREVIEW_CACHE_TTL,
  });

  while (linkPreviewDataCache.size > LINK_PREVIEW_CACHE_MAX_ENTRIES) {
    const oldestKey = linkPreviewDataCache.keys().next().value;

    if (!oldestKey) break;

    linkPreviewDataCache.delete(oldestKey);
  }
}

function fetchFirstSuccessfulProviderData(
  providers: LinkPreviewProvider[],
  context: LinkPreviewProviderContext
): Promise<LinkPreviewData | undefined> {
  if (providers.length === 0) return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    let settled = false;
    const results: Array<
      | {
          data?: LinkPreviewData;
          status: 'fulfilled';
        }
      | {
          error: unknown;
          status: 'rejected';
        }
      | undefined
    > = [];

    const resolveIfReady = () => {
      if (settled) return;

      for (let index = 0; index < providers.length; index += 1) {
        const result = results[index];

        if (!result) return;

        if (result.status === 'fulfilled' && result.data) {
          settled = true;
          resolve(result.data);
          return;
        }
      }

      const abortError = results.find((result) => result?.status === 'rejected' && isAbortError(result.error, context.signal));

      settled = true;
      if (abortError?.status === 'rejected') {
        reject(abortError.error);
      } else {
        resolve(undefined);
      }
    };

    providers.forEach((provider, index) => {
      void provider
        .fetch(context)
        .then((data) => {
          if (settled) return;

          results[index] = {
            data,
            status: 'fulfilled',
          };
          resolveIfReady();
        })
        .catch((error) => {
          if (settled) return;

          results[index] = {
            error,
            status: 'rejected',
          };
          resolveIfReady();
        });
    });
  });
}

export function parseGitHubPreviewTarget(
  contextOrUrl: LinkPreviewProviderContext | string
): GitHubPreviewTarget | undefined {
  const parsed =
    typeof contextOrUrl === 'string' ? parseUrl(processUrl(contextOrUrl) || contextOrUrl) : contextOrUrl.parsedUrl;

  if (!parsed) return undefined;
  if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) return undefined;

  const [owner, rawRepo, resource, number] = parsed.pathname.split('/').filter(Boolean);

  if (!owner || !rawRepo) return undefined;

  const repo = rawRepo.replace(/\.git$/, '');

  if ((resource === 'issues' || resource === 'pull') && number && /^\d+$/.test(number)) {
    return {
      owner,
      repo,
      kind: resource === 'pull' ? 'pull' : 'issue',
      number,
    };
  }

  if (!resource) {
    return {
      owner,
      repo,
      kind: 'repo',
    };
  }

  return undefined;
}

function normalizePreviewData(
  data: NonNullable<MicrolinkResponse['data']>,
  fallbackData: LinkPreviewData
): LinkPreviewData {
  return {
    title: normalizeString(data.title) || fallbackData.title,
    description: truncateDescription(normalizeString(data.description) || fallbackData.description),
    ...(normalizeString(data.image?.url) ? { image: { url: normalizeString(data.image?.url) } } : {}),
    ...(normalizeString(data.logo?.url) ? { logo: { url: normalizeString(data.logo?.url) } } : {}),
  };
}

function cleanupGitHubText(value?: string | null): string {
  return normalizeString(value)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateDescription(value: string): string {
  if (value.length <= DESCRIPTION_MAX_LENGTH) return value;

  return `${value.slice(0, DESCRIPTION_MAX_LENGTH - 1).trimEnd()}...`;
}

function normalizeString(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function raceWithAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      reject(createAbortError());
    };

    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
    };

    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError');
  }

  const error = new Error('Aborted');

  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || axios.isCancel(error)) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;

  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ERR_CANCELED'
  );
}
