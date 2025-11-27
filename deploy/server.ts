import * as fs from 'fs';
import path from 'path';

// @ts-expect-error no bun
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import { fetch } from 'bun';
import { type CheerioAPI, load } from 'cheerio';
import pino from 'pino';

const distDir = path.join(__dirname, 'dist');
const indexPath = path.join(distDir, 'index.html');
const baseURL = process.env.APPFLOWY_BASE_URL as string;
const defaultSite = 'https://appflowy.com';

type PublishErrorPayload = {
  code: 'NO_DEFAULT_PAGE' | 'PUBLISH_VIEW_LOOKUP_FAILED' | 'FETCH_ERROR' | 'UNKNOWN_FALLBACK';
  message: string;
  namespace?: string;
  publishName?: string;
  response?: unknown;
  detail?: string;
};

const appendPublishErrorScript = ($: CheerioAPI, error: PublishErrorPayload) => {
  const serialized = JSON.stringify(error)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  $('head').append(
    `<script id="appflowy-publish-error">window.__APPFLOWY_PUBLISH_ERROR__ = ${serialized};</script>`
  );
};

const setOrUpdateMetaTag = ($: CheerioAPI, selector: string, attribute: string, content: string) => {
  if ($(selector).length === 0) {
    const valueMatch = selector.match(/\[.*?="([^"]+)"\]/);
    const value = valueMatch?.[1] ?? '';

    $('head').append(`<meta ${attribute}="${value}" content="${content}">`);
  } else {
    $(selector).attr('content', content);
  }
};

const prettyTransport = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
  },
};

const logger = pino({
  transport: process.env.NODE_ENV === 'production' ? undefined : prettyTransport,
  level: process.env.LOG_LEVEL || 'info',
});

const logRequestTimer = (req: Request) => {
  const start = Date.now();
  const pathname = new URL(req.url).pathname;

  if (!pathname.startsWith('/health')) {
    logger.debug(`Incoming request: ${pathname}`);
  }

  return () => {
    const duration = Date.now() - start;

    if (!pathname.startsWith('/health')) {
      logger.debug(`Request for ${pathname} took ${duration}ms`);
    }
  };
};

const fetchMetaData = async (namespace: string, publishName?: string) => {
  let url = `${baseURL}/api/workspace/published/${namespace}`;

  if (publishName) {
    url = `${baseURL}/api/workspace/v1/published/${namespace}/${publishName}`;
  }

  logger.debug(`Fetching meta data from ${url}`);

  const response = await fetch(url, {
    verbose: false,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const data = await response.json();

  logger.debug(`Fetched meta data from ${url}: ${JSON.stringify(data)}`);

  return data;
};

export const createServer = async (req: Request) => {
  const timer = logRequestTimer(req);
  const reqUrl = new URL(req.url);
  const hostname = req.headers.get('host');

  if (!reqUrl.pathname.startsWith('/health')) {
    logger.info(`Request URL: ${hostname}${reqUrl.pathname}`);
  }

  if (reqUrl.pathname === '/') {
    timer();
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/app',
      },
    });
  }

  if (['/after-payment', '/login', '/as-template', '/app', '/accept-invitation', '/import'].some(item => reqUrl.pathname.startsWith(item))) {
    timer();
    const htmlData = fs.readFileSync(indexPath, 'utf8');
    const $ = load(htmlData);

    let title, description;

    if (reqUrl.pathname === '/after-payment') {
      title = 'Payment Success | AppFlowy';
      description = 'Payment success on AppFlowy';
    }

    if (reqUrl.pathname === '/login') {
      title = 'Login | AppFlowy';
      description = 'Login to AppFlowy';
    }

    if (title) $('title').text(title);
    if (description) setOrUpdateMetaTag($, 'meta[name="description"]', 'name', description);

    return new Response($.html(), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const [rawNamespace, rawPublishName] = reqUrl.pathname.slice(1).split('/');
  const namespace = decodeURIComponent(rawNamespace);
  const publishName = rawPublishName ? decodeURIComponent(rawPublishName) : undefined;

  logger.debug(`Namespace: ${namespace}, Publish Name: ${publishName}`);

  if (req.method === 'GET') {
    if (namespace === '') {
      timer();
      return new Response(null, {
        status: 302,
        headers: {
          Location: defaultSite,
        },
      });
    }

    let metaData;
    let redirectAttempted = false;
    let publishError: PublishErrorPayload | null = null;

    try {
      const data = await fetchMetaData(namespace, publishName);

      if (publishName) {
        if (data && data.code === 0) {
          metaData = data.data;
        } else {
          logger.error(
            `Publish view lookup failed for namespace="${namespace}" publishName="${publishName}" response=${JSON.stringify(data)}`
          );
          publishError = {
            code: 'PUBLISH_VIEW_LOOKUP_FAILED',
            message: 'The page you\'re looking for doesn\'t exist or has been unpublished.',
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
          timer();
          return new Response(null, {
            status: 302,
            headers: {
              Location: newURL,
            },
          });
        } else {
          logger.warn(`Namespace "${namespace}" has no default publish page. response=${JSON.stringify(data)}`);
          publishError = {
            code: 'NO_DEFAULT_PAGE',
            message: 'This workspace doesn\'t have a default published page. Please check the URL or contact the workspace owner.',
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

    const htmlData = fs.readFileSync(indexPath, 'utf8');
    const $ = load(htmlData);

    const description = 'Write, share, and publish docs quickly on AppFlowy.\nGet started for free.';
    let title = 'AppFlowy';
    const url = `https://${hostname}${reqUrl.pathname}`;
    let image = '/og-image.png';
    let favicon = '/appflowy.ico';

    try {
      if (metaData && metaData.view) {
        const view = metaData.view;
        const emoji = view.icon?.ty === 0 && view.icon?.value;
        const icon = view.icon?.ty === 2 && view.icon?.value;
        const titleList = [];

        if (emoji) {
          const emojiCode = emoji.codePointAt(0).toString(16); // Convert emoji to hex code
          const baseUrl = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u';

          favicon = `${baseUrl}${emojiCode}.svg`;
        } else if (icon) {
          try {
            const { iconContent, color } = JSON.parse(view.icon?.value);

            favicon = getIconBase64(iconContent, color);
            $('link[rel="icon"]').attr('type', 'image/svg+xml');
          } catch (_) {
            // Do nothing
          }
        }

        if (view.name) {
          titleList.push(view.name);
          titleList.push('|');
        }

        titleList.push('AppFlowy');
        title = titleList.join(' ');

        try {
          const cover = view.extra ? JSON.parse(view.extra)?.cover : null;

          if (cover) {
            if (['unsplash', 'custom'].includes(cover.type)) {
              image = cover.value;
            } else if (cover.type === 'built_in') {
              image = `/covers/m_cover_image_${cover.value}.png`;
            }
          }
        } catch (_) {
          // Do nothing
        }
      }
    } catch (error) {
      logger.error(`Error injecting meta data: ${error}`);
    }

    if (!metaData) {
      logger.warn(
        `Serving fallback landing page for namespace="${namespace}" publishName="${publishName ?? ''}". redirectAttempted=${redirectAttempted}`
      );
      if (!publishError) {
        publishError = {
          code: 'UNKNOWN_FALLBACK',
          message: 'We couldn\'t load this page. Please try again later.',
          namespace,
          publishName,
        };
      }
    }

    $('title').text(title);
    $('link[rel="icon"]').attr('href', favicon);
    $('link[rel="canonical"]').attr('href', url);
    setOrUpdateMetaTag($, 'meta[name="description"]', 'name', description);
    setOrUpdateMetaTag($, 'meta[property="og:title"]', 'property', title);
    setOrUpdateMetaTag($, 'meta[property="og:description"]', 'property', description);
    setOrUpdateMetaTag($, 'meta[property="og:image"]', 'property', image);
    setOrUpdateMetaTag($, 'meta[property="og:url"]', 'property', url);
    setOrUpdateMetaTag($, 'meta[property="og:site_name"]', 'property', 'AppFlowy');
    setOrUpdateMetaTag($, 'meta[property="og:type"]', 'property', 'website');
    setOrUpdateMetaTag($, 'meta[name="twitter:card"]', 'name', 'summary_large_image');
    setOrUpdateMetaTag($, 'meta[name="twitter:title"]', 'name', title);
    setOrUpdateMetaTag($, 'meta[name="twitter:description"]', 'name', description);
    setOrUpdateMetaTag($, 'meta[name="twitter:image"]', 'name', image);
    setOrUpdateMetaTag($, 'meta[name="twitter:site"]', 'name', '@appflowy');

    if (publishError) {
      appendPublishErrorScript($, publishError);
    }

    timer();
    return new Response($.html(), {
      headers: { 'Content-Type': 'text/html' },
    });
  } else {
    timer();
    logger.error({ message: 'Method not allowed', method: req.method });
    return new Response('Method not allowed', { status: 405 });
  }
};

declare const Bun: {
  serve: (options: { port: number; fetch: typeof createServer; error: (err: Error) => Response }) => void;
};

export const start = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Bun.serve({
      port: 3000,
      fetch: createServer,
      error: (err) => {
        logger.error(`Internal Server Error: ${err}`);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
    logger.info('Server is running on port 3000');
    logger.info(`Base URL: ${baseURL}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  start();
}

function getIconBase64(svgText: string, color: string) {
  let newSvgText = svgText.replace(/fill="[^"]*"/g, ``);

  newSvgText = newSvgText.replace('<svg', `<svg fill="${argbToRgba(color)}"`);

  const base64String = btoa(newSvgText);

  return `data:image/svg+xml;base64,${base64String}`;
}

function argbToRgba(color: string): string {
  const hex = color.replace(/^#|0x/, '');

  const hasAlpha = hex.length === 8;

  if (!hasAlpha) {
    return color.replace('0x', '#');
  }

  const r = parseInt(hex.slice(2, 4), 16);
  const g = parseInt(hex.slice(4, 6), 16);
  const b = parseInt(hex.slice(6, 8), 16);
  const a = hasAlpha ? parseInt(hex.slice(0, 2), 16) / 255 : 1;

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
