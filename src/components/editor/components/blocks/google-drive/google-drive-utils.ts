import { processUrl } from '@/utils/url';

const supportedGoogleDriveHosts = [
  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
  'forms.google.com',
];

function parseGoogleDriveUrl(rawUrl: string) {
  const processedUrl = processUrl(rawUrl) || rawUrl;

  try {
    return new URL(processedUrl);
  } catch {
    return null;
  }
}

export function isGoogleDriveUrl(rawUrl: string) {
  const url = parseGoogleDriveUrl(rawUrl);

  if (!url) return false;

  const host = url.host.toLowerCase();
  const matchesHost =
    supportedGoogleDriveHosts.some((supportedHost) => host === supportedHost) || host.endsWith('google.com');

  if (!matchesHost) return false;

  const path = url.pathname.toLowerCase();

  return (
    path.includes('/document/') ||
    path.includes('/spreadsheets/') ||
    path.includes('/presentation/') ||
    path.includes('/forms/') ||
    path.includes('/file/') ||
    path.includes('/folders/')
  );
}

function extractGoogleDriveId(url: URL, segments: string[]) {
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i];

    if (current === 'd' && i + 1 < segments.length) {
      const next = segments[i + 1];

      if (next === 'e' && i + 2 < segments.length) {
        return segments[i + 2];
      }

      return next;
    }

    if (current === 'folders' && i + 1 < segments.length) {
      return segments[i + 1];
    }
  }

  return url.searchParams.get('id') || url.searchParams.get('mid') || url.searchParams.get('resourcekey');
}

export function resolveGoogleDriveName(rawUrl: string) {
  const url = parseGoogleDriveUrl(rawUrl);

  if (!url) return rawUrl;

  const segments = url.pathname.split('/').filter(Boolean);

  if (!segments.length) return url.host;

  const ignored = new Set(['edit', 'view', 'preview']);
  let candidate: string | undefined;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];

    if ((segment === 'd' || segment === 'folders') && i + 1 < segments.length && !ignored.has(segments[i + 1])) {
      candidate = segments[i + 1];
      break;
    }
  }

  return candidate || [...segments].reverse().find((segment) => !ignored.has(segment)) || url.host;
}

export function buildGoogleDriveEmbeddedUrl(rawUrl: string) {
  const url = parseGoogleDriveUrl(rawUrl);

  if (!url) return rawUrl;

  const host = url.host.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  const id = extractGoogleDriveId(url, segments);

  if (!id) return processUrl(rawUrl) || rawUrl;

  const base = `${url.protocol}//${url.host}`;

  if (host.includes('docs.google.com')) {
    const type = segments[0] || '';

    switch (type) {
      case 'document':
      case 'spreadsheets':
        return `${base}/${type}/d/${id}/preview`;
      case 'presentation':
        return `${base}/presentation/d/${id}/embed?start=false&loop=false`;
      case 'forms':
        return `${base}/forms/d/e/${id}/viewform?embedded=true`;
      default:
        return `https://drive.google.com/file/d/${id}/preview`;
    }
  }

  if (host.includes('drive.google.com')) {
    if (segments.includes('folders')) {
      return `https://drive.google.com/embeddedfolderview?id=${id}#grid`;
    }

    return `https://drive.google.com/file/d/${id}/preview`;
  }

  return processUrl(rawUrl) || rawUrl;
}
