// Server-side link unfurler.
//
// Mirrors the desktop DefaultParser
// (AppFlowy-Premium/frontend/appflowy_flutter/lib/plugins/document/presentation/
//  editor_plugins/link_preview/link_parsers/default_parser.dart)
// so web link mentions reach parity with the desktop app: a browser cannot
// scrape cross-origin pages (CORS), so the same fetch + metadata extraction
// runs here instead. Prefer Open Graph, fall back to <title>, then host.
//
// Dependency-free on purpose: only the <head> meta/link tags are needed, so we
// parse them directly rather than pulling an HTML parser into the function.

import { isAllowedHttpUrl } from './url-safety';

const MAX_HTML_BYTES = 50 * 1024; // the <head> carries all the metadata we read
const REQUEST_TIMEOUT_MS = 8000;
const DESCRIPTION_MAX_LENGTH = 240;
const USER_AGENT = 'Mozilla/5.0 (compatible; AppFlowyBot/1.0; +https://appflowy.io)';
const MAX_REDIRECTS = 5;

export interface UnfurlImage {
  url: string;
}

export interface UnfurlResult {
  title: string;
  description: string;
  siteName?: string;
  image?: UnfurlImage;
  logo?: UnfurlImage;
  // A favicon variant for dark themes. Some sites (notably GitHub) ship a
  // near-black monochrome favicon that is invisible on a dark background; the
  // client picks this when in dark mode. Mirrors the desktop parser's
  // darkFaviconUrl.
  logoDark?: UnfurlImage;
}

const GITHUB_DARK_FAVICON = 'https://github.githubassets.com/favicons/favicon-dark.png';

function isGithubHost(host: string): boolean {
  return host === 'github.com' || host.endsWith('.github.com');
}

interface FetchedHtml {
  response: Response;
  url: URL;
}

export async function unfurl(rawUrl: string): Promise<UnfurlResult> {
  const initialUrl = new URL(rawUrl);
  const { response, url } = await fetchHtml(initialUrl);
  const host = url.hostname.replace(/^www\./, '');

  // Parse the response body regardless of HTTP status. Many sites return useful
  // Open Graph metadata on non-2xx responses (login walls, soft 404s, etc.), and
  // this mirrors the desktop DefaultParser, which never inspects the status code.
  // When the body carries no metadata, extractMetadata still falls back to the
  // host title + favicon.
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!isHtml(contentType)) {
    void response.body?.cancel().catch(() => undefined);
    return nonHtmlResult(url, host, contentType);
  }

  const head = await readHead(response);

  return extractMetadata(head, url, host);
}

async function fetchHtml(url: URL): Promise<FetchedHtml> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetchHtmlFollowingAllowedRedirects(url, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtmlFollowingAllowedRedirects(initialUrl: URL, signal: AbortSignal): Promise<FetchedHtml> {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!isAllowedHttpUrl(currentUrl)) {
      throw new Error('Blocked redirect target');
    }

    const response = await fetch(currentUrl.toString(), {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!isRedirectResponse(response.status)) return { response, url: currentUrl };

    const location = response.headers.get('location');

    void response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error('Redirect response missing Location header');

    const nextUrl = new URL(location, currentUrl);

    if (!isAllowedHttpUrl(nextUrl)) {
      throw new Error('Blocked redirect target');
    }

    currentUrl = nextUrl;
  }

  throw new Error('Too many redirects');
}

function isRedirectResponse(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isHtml(contentType: string): boolean {
  return contentType === '' || contentType.includes('text/html') || contentType.includes('application/xhtml');
}

// Read only up to </head> (or 50KB) to keep the function fast and cheap.
async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) return response.text();

  const decoder = new TextDecoder('utf-8');
  let html = '';
  let received = 0;

  while (received < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();

    if (done) break;
    received += value.byteLength;
    html += decoder.decode(value, { stream: true });

    const headEnd = html.toLowerCase().indexOf('</head>');

    if (headEnd !== -1) {
      html = html.slice(0, headEnd + '</head>'.length);
      break;
    }
  }

  void reader.cancel().catch(() => undefined);
  return html;
}

function extractMetadata(head: string, url: URL, host: string): UnfurlResult {
  const metas = matchTags(head, 'meta');
  const links = matchTags(head, 'link');

  const og = (property: string) => metas.find((attrs) => attrs.property === property)?.content;
  const named = (name: string) => metas.find((attrs) => attrs.name === name)?.content;

  const title = clean(og('og:title')) || clean(extractTitleTag(head)) || clean(named('title')) || host;
  const description = clean(og('og:description')) || clean(named('description'));
  const siteName = clean(og('og:site_name'));
  const image = resolveOptional(url, og('og:image'));
  const favicon = extractFavicon(links, url) ?? defaultFavicon(host);

  return {
    title,
    description: truncate(description),
    ...(siteName ? { siteName } : {}),
    ...(image ? { image: { url: image } } : {}),
    logo: { url: favicon },
    ...(isGithubHost(host) ? { logoDark: { url: GITHUB_DARK_FAVICON } } : {}),
  };
}

function extractFavicon(links: Array<Record<string, string>>, url: URL): string | undefined {
  const rels = ['icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'];

  for (const rel of rels) {
    const href = links.find((attrs) => (attrs.rel ?? '').toLowerCase() === rel)?.href;

    if (href) return resolveOptional(url, href);
  }

  const anyIcon = links.find((attrs) => (attrs.rel ?? '').toLowerCase().includes('icon'))?.href;

  return anyIcon ? resolveOptional(url, anyIcon) : undefined;
}

function matchTags(html: string, tag: 'meta' | 'link'): Array<Record<string, string>> {
  const regex = new RegExp(`<${tag}\\b[^>]*>`, 'gi');

  return (html.match(regex) ?? []).map(parseAttributes);
}

const ATTR_REGEX = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;

  ATTR_REGEX.lastIndex = 0;
  while ((match = ATTR_REGEX.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }

  return attrs;
}

function extractTitleTag(html: string): string | undefined {
  return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
}

function nonHtmlResult(url: URL, host: string, contentType: string): UnfurlResult {
  const filename = url.pathname.split('/').filter(Boolean).pop() || host;

  return {
    title: decodeURIComponentSafe(filename),
    description: contentType ? `Type: ${contentType}` : '',
    logo: { url: defaultFavicon(host) },
  };
}

function defaultFavicon(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
}

function resolveOptional(base: URL, href?: string): string | undefined {
  if (!href) return undefined;

  const decoded = decodeEntities(href).trim();

  if (!decoded) return undefined;

  try {
    return new URL(decoded, base).toString();
  } catch {
    return decoded;
  }
}

function clean(value?: string): string {
  return decodeEntities(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string): string {
  if (value.length <= DESCRIPTION_MAX_LENGTH) return value;
  return `${value.slice(0, DESCRIPTION_MAX_LENGTH - 1).trimEnd()}…`;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);

      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}
