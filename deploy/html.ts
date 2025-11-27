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

export type RenderPublishPageOptions = {
  hostname: string | null;
  pathname: string;
  metaData?: {
    view?: PublishViewMeta;
  };
  publishError?: PublishErrorPayload | null;
};

export const renderPublishPage = ({ hostname, pathname, metaData, publishError }: RenderPublishPageOptions) => {
  const htmlData = fs.readFileSync(indexPath, 'utf8');
  const $ = load(htmlData);

  const description = DEFAULT_DESCRIPTION;
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

const setOrUpdateMetaTag = ($: CheerioAPI, selector: string, attribute: string, content: string) => {
  if ($(selector).length === 0) {
    const valueMatch = selector.match(/\[.*?="([^"]+)"\]/);
    const value = valueMatch?.[1] ?? '';

    $('head').append(`<meta ${attribute}="${value}" content="${content}">`);
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
