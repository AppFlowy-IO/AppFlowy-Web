export interface AppFlowyBlockLink {
  pageId: string;
  blockId: string;
}

export function parseAppFlowyBlockLink(raw: string, expectedHostname?: string): AppFlowyBlockLink | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(raw.trim());
  } catch {
    return null;
  }

  if (!isHttpUrl(parsedUrl)) return null;
  if (expectedHostname && parsedUrl.hostname !== expectedHostname) return null;

  const segments = parsedUrl.pathname.split('/').filter(Boolean);

  if (segments.length !== 3 || segments[0] !== 'app') return null;

  const blockId = parsedUrl.searchParams.get('blockId');

  if (!blockId) return null;

  return {
    pageId: segments[2],
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
  return pickSingleHttpUrl(value?.split(/\r\n|\r|\n/));
}

function getSingleURLTextFromUriList(value: string | undefined): string | undefined {
  return pickSingleHttpUrl(value?.split(/\r\n|\r|\n/).filter((line) => !line.trim().startsWith('#')));
}

function getSingleURLTextFromHTML(html: string | undefined): string | undefined {
  const trimmed = html?.trim();

  if (!trimmed || typeof DOMParser === 'undefined') return undefined;

  try {
    const doc = new DOMParser().parseFromString(trimmed, 'text/html');
    const text = pickSingleHttpUrl(doc.body.textContent?.split(/\r\n|\r|\n/));

    if (text) return text;

    const href = doc.querySelector('a[href]')?.getAttribute('href')?.trim();

    return pickSingleHttpUrl(href ? [href] : undefined);
  } catch {
    return undefined;
  }
}

function pickSingleHttpUrl(lines: string[] | undefined): string | undefined {
  const normalized = lines?.map((line) => line.trim()).filter(Boolean);

  if (!normalized || normalized.length !== 1) return undefined;

  return tryParseHttpUrl(normalized[0]) ? normalized[0] : undefined;
}

function tryParseHttpUrl(value: string | undefined): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    return isHttpUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}
