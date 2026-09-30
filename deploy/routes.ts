import fs from 'fs';
import path from 'path';

import { fetchPublishedViewRoute, fetchPublishMetadata, fetchPublishSnapshot, type SnapshotFetchResult } from './api';
import { APP_PATHS, matchesAppPath } from './app-paths';
import { defaultSite, distDir } from './config';
import { type PublishPageSsr, renderMarketingPage, renderPublishPage } from './html';
import {
  type IndexingDecision,
  modeRendersBody,
  parseNamespaceAllowlist,
  resolvePublishRenderMode,
} from './indexing-policy';
import { logger } from './logger';
import { type PublishErrorPayload } from './publish-error';
import { resolveViewHrefs } from './publish-links';
import { collectLinkedViewIds, serializePublishedPage } from './publish-serializer';
import { type RequestContext } from './server';
import { readSsrSettings, type SsrSettings } from './ssr-config';


type RouteHandler = (context: RequestContext) => Promise<Response | undefined>;

// Static file paths that should be served from dist
const STATIC_PATHS = ['/static/', '/af_icons/', '/covers/', '/.well-known/'];
const STATIC_FILES = ['/appflowy.ico', '/appflowy.svg', '/og-image.png'];

// Vite emits content-hashed filenames under /static/, so they can be cached
// forever; other assets keep a short lifetime. HTML must always be
// revalidated so browsers with a warm profile never run a stale app shell.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const STATIC_CACHE_CONTROL = 'public, max-age=3600';
const HTML_CACHE_CONTROL = 'no-cache';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const staticRoute = async ({ req, url }: RequestContext) => {
  if (req.method !== 'GET') {
    return;
  }

  const isStaticPath = STATIC_PATHS.some(p => url.pathname.startsWith(p));
  const isStaticFile = STATIC_FILES.includes(url.pathname);

  if (!isStaticPath && !isStaticFile) {
    return;
  }

  // Strip leading slash and decode the path
  const relativePath = url.pathname.slice(1);

  // Decode URL-encoded characters to detect encoded path traversal attempts
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    // Invalid URL encoding
    logger.warn(`Invalid URL encoding blocked: ${url.pathname}`);
    return new Response('Bad Request', { status: 400 });
  }

  // Check for path traversal patterns in the decoded path
  if (decodedPath.includes('..')) {
    logger.warn(`Path traversal attempt blocked: ${url.pathname}`);
    return new Response('Forbidden', { status: 403 });
  }

  // Resolve the full path using the decoded path
  const filePath = path.resolve(distDir, decodedPath);

  // Defense in depth: ensure resolved path stays within distDir
  const normalizedDistDir = path.resolve(distDir);

  if (!filePath.startsWith(normalizedDistDir + path.sep) && filePath !== normalizedDistDir) {
    logger.warn(`Path traversal attempt blocked: ${url.pathname}`);
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const file = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheControl = url.pathname.startsWith('/static/') ? IMMUTABLE_CACHE_CONTROL : STATIC_CACHE_CONTROL;

    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
      },
    });
  } catch {
    logger.warn(`Static file not found: ${filePath}`);
    return;
  }
};

const appRoute = async ({ req, url }: RequestContext) => {
  if (req.method !== 'GET') {
    return;
  }

  if (APP_PATHS.some(path => matchesAppPath(url.pathname, path))) {
    const html = renderMarketingPage(url.pathname);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': HTML_CACHE_CONTROL,
      },
    });
  }
};

const publishRoute = async ({ req, url, hostname }: RequestContext) => {
  if (req.method !== 'GET') {
    return;
  }

  const [rawNamespace, rawPublishName] = url.pathname.slice(1).split('/');
  let namespace: string;
  let publishName: string | undefined;

  try {
    namespace = rawNamespace ? decodeURIComponent(rawNamespace) : '';
    publishName = rawPublishName ? decodeURIComponent(rawPublishName) : undefined;
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  if (namespace === '') {
    return new Response(null, {
      status: 302,
      headers: { Location: defaultSite },
    });
  }

  const env = process.env;
  const ssrSettings = readSsrSettings(env);

  // SSR only applies to a specific page. When the decision can already be made
  // without metadata (i.e. the namespace is allowlisted and the kill switch is
  // off), start the snapshot fetch now so it runs alongside the metadata fetch.
  // A publisher opt-out in the metadata can still cancel it below; the result
  // is then discarded. In every other case no snapshot request is made here,
  // so default-mode pages cost exactly the same upstream calls as before.
  const earlyDecision = publishName ? resolvePublishRenderMode({ namespace, publishName, env }) : undefined;
  let pendingSnapshot =
    publishName && earlyDecision && modeRendersBody(earlyDecision.mode)
      ? startSnapshotFetch(namespace, publishName, ssrSettings.snapshotTimeoutMs)
      : undefined;

  let metaData;
  let redirectAttempted = false;
  let publishError: PublishErrorPayload | null = null;

  try {
    const data = await fetchPublishMetadata(namespace, publishName);

    if (publishName) {
      if (data && data.code === 0) {
        metaData = data.data;
      } else {
        logger.error(
          `Publish view lookup failed for namespace="${namespace}" publishName="${publishName}" response=${JSON.stringify(data)}`
        );
        publishError = {
          code: 'PUBLISH_VIEW_LOOKUP_FAILED',
          message: "The page you're looking for doesn't exist or has been unpublished.",
          namespace,
          publishName,
          response: data,
        };
      }
    } else {
      const publishInfo = data?.data?.info;

      if (publishInfo?.namespace && publishInfo?.publish_name) {
        const newURL = `/${encodeURIComponent(publishInfo.namespace)}/${encodeURIComponent(publishInfo.publish_name)}`;

        logger.debug(`Redirecting to default page in: ${JSON.stringify(publishInfo)}`);
        redirectAttempted = true;

        return new Response(null, {
          status: 302,
          headers: { Location: newURL },
        });
      } else {
        logger.warn(`Namespace "${namespace}" has no default publish page. response=${JSON.stringify(data)}`);
        publishError = {
          code: 'NO_DEFAULT_PAGE',
          message: "This workspace doesn't have a default published page. Please check the URL or contact the workspace owner.",
          namespace,
          response: data,
        };
      }
    }
  } catch (error) {
    logger.error(`Error fetching meta data: ${error}`);
    publishError = {
      code: 'FETCH_ERROR',
      message: 'Unable to load this page. Please check your internet connection and try again.',
      namespace,
      publishName,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!metaData) {
    logger.warn(
      `Serving fallback landing page for namespace="${namespace}" publishName="${publishName ?? ''}". redirectAttempted=${redirectAttempted}`
    );
    if (!publishError) {
      publishError = {
        code: 'UNKNOWN_FALLBACK',
        message: "We couldn't load this page. Please try again later.",
        namespace,
        publishName,
      };
    }
  }

  // SSR is only considered for a page whose metadata loaded. Error and
  // fallback pages keep today's response untouched.
  let decision: IndexingDecision | undefined;
  let ssr: PublishPageSsr | undefined;

  if (metaData && publishName) {
    decision = resolvePublishRenderMode({ namespace, publishName, publishConfig: metaData.config, env });

    if (modeRendersBody(decision.mode)) {
      // Opted in via metadata (rule 3) and not fetched early: fetch now.
      pendingSnapshot ??= startSnapshotFetch(namespace, publishName, ssrSettings.snapshotTimeoutMs);
      ssr = await buildSsrBody(pendingSnapshot, ssrSettings, namespace, publishName);
    }

    const level = decision.reason === 'default_off' ? 'debug' : 'info';

    logger[level](
      `Publish render namespace="${namespace}" publishName="${publishName}" mode=${decision.mode} reason=${decision.reason} ssr=${ssr ? 'rendered' : 'none'}`
    );
  }

  // The robots directive follows the decision, not whether SSR succeeded: a
  // page that asked for noindex keeps it even if its body fell back to the shell.
  const robots = decision?.robots ?? null;
  const html = renderPublishPage({
    hostname,
    pathname: url.pathname,
    metaData,
    publishError,
    ...(ssr ? { ssr } : {}),
    ...(robots ? { robots } : {}),
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': HTML_CACHE_CONTROL,
      ...(robots ? { 'X-Robots-Tag': robots } : {}),
    },
  });
};

/**
 * Starts the snapshot fetch, guaranteeing the returned promise never rejects,
 * so an early (speculative) fetch that ends up unused can never surface as an
 * unhandled rejection.
 */
const startSnapshotFetch = (namespace: string, publishName: string, timeoutMs: number) =>
  Promise.resolve()
    .then(() => fetchPublishSnapshot(namespace, publishName, timeoutMs))
    .catch((): SnapshotFetchResult => ({ ok: false, reason: 'network_error' }));

/**
 * Resolves published URLs for the pages a snapshot links to.
 *
 * Only targets in the current namespace or in an allowlisted namespace are
 * linked. A link hands crawlers a URL, so SSR must never become the path by
 * which a namespace that has not opted in gets crawled. (The client app shows
 * all these links to readers regardless; this only limits the server markup.)
 *
 * @returns view id → URL. Empty on any failure, so the page still renders
 *   with plain names rather than losing SSR over its links.
 */
const resolveLinkHrefs = async (
  snapshot: unknown,
  namespace: string,
  timeoutMs: number
): Promise<Map<string, string>> => {
  try {
    const allowlist = parseNamespaceAllowlist(process.env.APPFLOWY_INDEXABLE_NAMESPACES);

    return await resolveViewHrefs(collectLinkedViewIds(snapshot), {
      fetchRoute: fetchPublishedViewRoute,
      timeoutMs,
      isLinkableNamespace: (target) => target === namespace || allowlist.has(target),
    });
  } catch (error) {
    logger.warn(`SSR link resolution failed, rendering names without links: namespace="${namespace}" error=${error}`);
    return new Map();
  }
};

/**
 * Turns a snapshot fetch into the SSR body for `renderPublishPage`.
 *
 * @returns The body and, when small enough, the snapshot to inline. Returns
 *   undefined on any failure — fetch error, timeout, a snapshot the serializer
 *   refuses (e.g. a database page), or an unexpected exception — and the caller
 *   then serves the head-only shell. SSR is an enhancement: a failure here must
 *   never become an error response.
 */
const buildSsrBody = async (
  pending: Promise<SnapshotFetchResult>,
  settings: SsrSettings,
  namespace: string,
  publishName: string
): Promise<PublishPageSsr | undefined> => {
  const context = `namespace="${namespace}" publishName="${publishName}"`;

  try {
    const result = await pending;

    if (!result.ok) {
      logger.warn(`SSR snapshot unavailable (${result.reason}), serving shell: ${context}`);
      return undefined;
    }

    const viewHrefs = await resolveLinkHrefs(result.snapshot, namespace, settings.snapshotTimeoutMs);
    const serialized = serializePublishedPage(result.snapshot, { viewHrefs });

    if (!serialized.ok) {
      logger.warn(`SSR serializer declined (${serialized.reason}), serving shell: ${context}`);
      return undefined;
    }

    // Inlining lets the client skip its own fetch, but the snapshot also carries
    // the raw block data, roughly doubling large pages. Past the limit, keep the
    // server-rendered body and let the client fetch the snapshot as it does today.
    const inlineSize = Buffer.byteLength(JSON.stringify(result.snapshot), 'utf8');

    return {
      bodyHtml: serialized.html,
      snapshot: inlineSize <= settings.maxInlineBytes ? result.snapshot : undefined,
    };
  } catch (error) {
    logger.error(`SSR failed unexpectedly, serving shell: ${context} error=${error}`);
    return undefined;
  }
};

const methodNotAllowed = async ({ req }: RequestContext) => {
  if (req.method !== 'GET') {
    logger.error({ message: 'Method not allowed', method: req.method });
    return new Response('Method not allowed', { status: 405 });
  }
};

const notFound = async () => new Response('Not Found', { status: 404 });

export const routes: RouteHandler[] = [staticRoute, appRoute, publishRoute, methodNotAllowed, notFound];
