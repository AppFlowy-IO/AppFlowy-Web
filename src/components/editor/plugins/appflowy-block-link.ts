export interface AppFlowyBlockLink {
  pageId: string;
  blockId: string;
}

const UUID_PATTERN = '[0-9a-fA-F-]{36}';
const APPFLOWY_BLOCK_LINK_PATTERN = new RegExp(
  `^https?://[^/]+/app/(${UUID_PATTERN})/(${UUID_PATTERN})(?:[?#][^\\s]*)?$`
);

export function parseAppFlowyBlockLink(url: string): AppFlowyBlockLink | null {
  const trimmed = url.trim();
  const match = APPFLOWY_BLOCK_LINK_PATTERN.exec(trimmed);

  if (!match) return null;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return null;
  }

  const blockId = parsedUrl.searchParams.get('blockId');

  if (!blockId) return null;

  return {
    pageId: match[2],
    blockId,
  };
}

export function getSingleURLTextFromClipboardData(data: Pick<DataTransfer, 'getData'>): string | undefined {
  return (
    getSingleURLText(getClipboardData(data, 'text/plain')) ??
    getSingleURLTextFromUriList(getClipboardData(data, 'text/uri-list')) ??
    getSingleURLTextFromHTML(getClipboardData(data, 'text/html'))
  );
}

function getClipboardData(data: Pick<DataTransfer, 'getData'>, type: string): string {
  try {
    return data.getData(type) || '';
  } catch {
    return '';
  }
}

function getSingleURLText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) return undefined;
  if (trimmed.split(/\r\n|\r|\n/).filter(Boolean).length !== 1) return undefined;

  return isHTTPURL(trimmed) ? trimmed : undefined;
}

function getSingleURLTextFromUriList(value: string | undefined): string | undefined {
  const urls = value
    ?.split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (!urls || urls.length !== 1) return undefined;

  return isHTTPURL(urls[0]) ? urls[0] : undefined;
}

function getSingleURLTextFromHTML(html: string | undefined): string | undefined {
  const trimmed = html?.trim();

  if (!trimmed || typeof DOMParser === 'undefined') return undefined;

  try {
    const doc = new DOMParser().parseFromString(trimmed, 'text/html');
    const text = getSingleURLText(doc.body.textContent ?? undefined);

    if (text) return text;

    const href = doc.querySelector('a[href]')?.getAttribute('href')?.trim();

    return getSingleURLText(href);
  } catch {
    return undefined;
  }
}

function isHTTPURL(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
