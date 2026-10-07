import * as fs from 'fs';

import { type CheerioAPI, load } from 'cheerio';

import { indexPath } from './config';
import { logger } from './logger';
import { type PublishErrorPayload } from './publish-error';

const DEFAULT_DESCRIPTION = 'Write, share, and publish docs quickly on AppFlowy.\nGet started for free.';
const DEFAULT_IMAGE = '/og-image.png';
const DEFAULT_FAVICON = '/appflowy.ico';

const MARKETING_META: Record<
  string,
  {
    title?: string;
    description?: string;
  }
> = {
  '/after-payment': {
    title: 'Payment Success | AppFlowy',
    description: 'Payment success on AppFlowy',
  },
  '/login': {
    title: 'Login | AppFlowy',
    description: 'Login to AppFlowy',
  },
};

export const renderMarketingPage = (pathname: string) => {
  const htmlData = fs.readFileSync(indexPath, 'utf8');
  const $ = load(htmlData);
  const meta = MARKETING_META[pathname];

  if (meta?.title) {
    $('title').text(meta.title);
  }

  if (meta?.description) {
    setOrUpdateMetaTag($, 'meta[name="description"]', 'name', meta.description);
  }

  return $.html();
};

type PublishViewMeta = {
  name?: string;
  icon?: {
    ty: number;
    value: string;
  };
  extra?: string;
};

export type PublishPageSsr = {
  /** Serialized page body from `serializePublishedPage`, already escaped. */
  bodyHtml: string;
  /**
   * The snapshot to inline for the client, already serialized with
   * `JSON.stringify`, or undefined when it is too large to inline (the client
   * then fetches it as it would without SSR).
   */
  snapshotJson?: string;
  /**
   * Plain-text description derived from the page content, replacing the
   * generic default in the description meta tags. Undefined keeps the default.
   */
  description?: string;
};

export type RenderPublishPageOptions = {
  hostname: string | null;
  pathname: string;
  metaData?: {
    view?: PublishViewMeta;
  };
  publishError?: PublishErrorPayload | null;
  /** Present only in SSR modes; absent means today's head-only shell. */
  ssr?: PublishPageSsr;
  /** Robots directive for `<meta name="robots">`, or null/undefined for none. */
  robots?: string | null;
};

// Approximates the published editor's layout (48px header, centred column,
// narrower padding on phones) so the server-rendered text sits roughly where
// the app will draw it, and the swap when React mounts looks like a restyle
// rather than a jump. Scoped to [data-appflowy-ssr] and only injected in SSR
// modes, so default-mode pages are unaffected.
//
// The app's global CSS sets `html, body { height: 100%; overflow: hidden }`
// because the app scrolls inside its own containers. Before the app mounts,
// #root is the only thing that can scroll the article, so it becomes the
// scroll container while — and only while — it holds the SSR article: once
// React replaces the article, `:has()` stops matching and the app's layout is
// untouched.
const SSR_STYLE = `#root:has(> [data-appflowy-ssr]){height:100%;overflow-y:auto}
[data-appflowy-ssr]{box-sizing:border-box;max-width:952px;margin:0 auto;padding:96px 96px 48px;line-height:1.6;overflow-wrap:anywhere}
[data-appflowy-ssr] h1{font-size:2.5rem;font-weight:700;line-height:1.2;margin:0 0 1.5rem}
[data-appflowy-ssr] h2{font-size:1.875rem;font-weight:600;margin:1.5rem 0 .5rem}
[data-appflowy-ssr] h3{font-size:1.5rem;font-weight:600;margin:1.25rem 0 .5rem}
[data-appflowy-ssr] h4,[data-appflowy-ssr] h5,[data-appflowy-ssr] h6{font-size:1.25rem;font-weight:600;margin:1rem 0 .5rem}
[data-appflowy-ssr] p,[data-appflowy-ssr] pre,[data-appflowy-ssr] figure,[data-appflowy-ssr] table,[data-appflowy-ssr] blockquote,[data-appflowy-ssr] aside,[data-appflowy-ssr] details{margin:.25rem 0}
[data-appflowy-ssr] ul{list-style:disc;padding-left:1.5rem}
[data-appflowy-ssr] ol{list-style:decimal;padding-left:1.5rem}
[data-appflowy-ssr] blockquote{border-left:4px solid currentColor;padding-left:1rem;opacity:.85}
[data-appflowy-ssr] pre{white-space:pre-wrap;padding:1rem;border-radius:8px;background:rgba(127,127,127,.12)}
[data-appflowy-ssr] img{max-width:100%;height:auto}
[data-appflowy-ssr] a{text-decoration:underline}
[data-appflowy-ssr] td{border:1px solid rgba(127,127,127,.35);padding:.25rem .5rem;vertical-align:top}
@media (max-width:640px){[data-appflowy-ssr]{padding:72px 24px 32px}}`;

// U+2028/U+2029, built from code points so the source never contains the raw
// characters (editors and tools mangle them).
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');

/**
 * Makes serialized JSON safe to embed in a <script> element. JSON alone is not
 * enough: "</script>" or "<!--" inside a string would end the script element
 * early, and U+2028/U+2029 are line terminators in older JavaScript engines.
 * Escaping <, >, & and those two characters as \uXXXX keeps the JSON value
 * identical once parsed.
 */
const toInlineScriptJson = (json: string) =>
  json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATOR, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR, '\\u2029');

/**
 * Renders the HTML for a published page.
 *
 * @param options.hostname - Request host, used for canonical and og:url.
 * @param options.pathname - Request path.
 * @param options.metaData - Published view metadata for title, favicon and cover.
 * @param options.publishError - Error payload to hand to the client, if any.
 * @param options.ssr - SSR body and optional inlined snapshot. When omitted the
 *   output is exactly the pre-SSR head-only shell.
 * @param options.robots - Robots directive for `<meta name="robots">`, if any.
 *   The caller sends the matching `X-Robots-Tag` header.
 * @returns The HTML document. Metadata parsing errors are logged and ignored,
 *   as before.
 */
export const renderPublishPage = ({
  hostname,
  pathname,
  metaData,
  publishError,
  ssr,
  robots,
}: RenderPublishPageOptions) => {
  const htmlData = fs.readFileSync(indexPath, 'utf8');
  const $ = load(htmlData);

  // Only server-rendered pages get a content-derived description; every other
  // page keeps the default so its response stays exactly as before SSR.
  const description = ssr?.description ?? DEFAULT_DESCRIPTION;
  let title = 'AppFlowy';
  const url = `https://${hostname ?? ''}${pathname}`;
  let image = DEFAULT_IMAGE;
  let favicon = DEFAULT_FAVICON;

  try {
    if (metaData && metaData.view) {
      const view = metaData.view;
      const emoji = view.icon?.ty === 0 && view.icon?.value;
      const icon = view.icon?.ty === 2 && view.icon?.value;
      const titleList: string[] = [];

      if (emoji) {
        const emojiCode = emoji.codePointAt(0)?.toString(16);
        const baseUrl = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u';

        if (emojiCode) {
          favicon = `${baseUrl}${emojiCode}.svg`;
        }
      } else if (icon) {
        try {
          const { iconContent, color } = JSON.parse(icon);

          favicon = getIconBase64(iconContent, color);
          $('link[rel="icon"]').attr('type', 'image/svg+xml');
        } catch (_) {
          // ignore icon parsing errors
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
        // ignore cover parsing errors
      }
    }
  } catch (error) {
    logger.error(`Error injecting meta data: ${error}`);
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

  // Everything below is additive and gated: with no `robots` and no `ssr`, the
  // document is byte-identical to the pre-SSR output (see publish-golden.test.ts).
  if (robots) {
    setOrUpdateMetaTag($, 'meta[name="robots"]', 'name', robots);
  }

  if (ssr) {
    $('head').append(`<style id="appflowy-ssr-style">${SSR_STYLE}</style>`);
    // The client mounts with createRoot, not hydrateRoot, so this markup never
    // has to match React's output. The client keeps the article on screen
    // through its route-loading fallbacks and drops it once the page commits
    // (src/components/_shared/ServerRenderedFallback.tsx), which relies on the
    // article being the direct `[data-appflowy-ssr]` child of #root.
    $('#root').html(ssr.bodyHtml);

    // A data block after #root rather than an executable script in <head>: the
    // browser does not have to download and run up to a megabyte of script
    // before it can paint the article above, and the client reads it with
    // JSON.parse, which is faster than evaluating an object literal that size.
    if (ssr.snapshotJson !== undefined) {
      $('#root').after(
        `<script type="application/json" id="appflowy-publish-snapshot">${toInlineScriptJson(ssr.snapshotJson)}</script>`
      );
    }
  }

  return $.html();
};

const appendPublishErrorScript = ($: CheerioAPI, error: PublishErrorPayload) => {
  const serialized = JSON.stringify(error)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  $('head').append(
    `<script id="appflowy-publish-error">window.__APPFLOWY_PUBLISH_ERROR__ = ${serialized};</script>`
  );
};

/**
 * Sets a meta tag's `content`, creating the tag in <head> if the template lacks it.
 *
 * Content is frequently user-controlled (page titles, descriptions), so both
 * paths go through cheerio's `attr`, which escapes attribute values. The
 * creation path must never build the tag by string interpolation: a page named
 * `"><script>…` would otherwise inject markup whenever a tag is missing from
 * the template.
 *
 * @param selector - A `meta[<attribute>="<value>"]` selector identifying the tag.
 * @param attribute - The identifying attribute (`name` or `property`).
 * @param content - The value to set; any string, escaped on output.
 */
const setOrUpdateMetaTag = ($: CheerioAPI, selector: string, attribute: string, content: string) => {
  if ($(selector).length === 0) {
    const valueMatch = selector.match(/\[.*?="([^"]+)"\]/);
    const value = valueMatch?.[1] ?? '';

    $('head').append($('<meta>').attr(attribute, value).attr('content', content));
  } else {
    $(selector).attr('content', content);
  }
};

const getIconBase64 = (svgText: string, color: string) => {
  let newSvgText = svgText.replace(/fill="[^"]*"/g, ``);

  newSvgText = newSvgText.replace('<svg', `<svg fill="${argbToRgba(color)}"`);

  const base64String = btoa(newSvgText);

  return `data:image/svg+xml;base64,${base64String}`;
};

const argbToRgba = (color: string): string => {
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
};
