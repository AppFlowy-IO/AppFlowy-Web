import fs from 'fs';
import path from 'path';

import { fetchPublishMetadata } from './api';
import { defaultSite, distDir } from './config';
import { renderMarketingPage, renderPublishPage } from './html';
import { logger } from './logger';
import { type PublishErrorPayload } from './publish-error';
import { type RequestContext } from './server';


type RouteHandler = (context: RequestContext) => Promise<Response | undefined>;

const MARKETING_PATHS = ['/after-payment', '/login', '/as-template', '/app', '/accept-invitation', '/import'];

// Static file paths that should be served from dist
const STATIC_PATHS = ['/static/', '/af_icons/', '/covers/', '/.well-known/'];
const STATIC_FILES = ['/appflowy.ico', '/appflowy.svg', '/og-image.png'];

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

    return new Response(file, {
      headers: { 'Content-Type': contentType },
    });
  } catch {
    logger.warn(`Static file not found: ${filePath}`);
    return;
  }
};

const marketingRoute = async ({ req, url }: RequestContext) => {
  if (req.method !== 'GET') {
    return;
  }

  if (MARKETING_PATHS.some(path => url.pathname.startsWith(path))) {
    const html = renderMarketingPage(url.pathname);

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
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

  const html = renderPublishPage({
    hostname,
    pathname: url.pathname,
    metaData,
    publishError,
  });

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
};

const methodNotAllowed = async ({ req }: RequestContext) => {
  if (req.method !== 'GET') {
    logger.error({ message: 'Method not allowed', method: req.method });
    return new Response('Method not allowed', { status: 405 });
  }
};

const notFound = async () => new Response('Not Found', { status: 404 });

export const routes: RouteHandler[] = [staticRoute, marketingRoute, publishRoute, methodNotAllowed, notFound];
