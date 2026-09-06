import download from 'downloadjs';

import { getTokenParsed } from '@/application/session/token';
import {
  isAppFlowyAuthenticatedFileUrl,
  isAppFlowyFileStorageUrl,
  isAppFlowyPublicFormUploadUrl,
} from '@/utils/file-storage-url';
import { openUrl } from '@/utils/url';

/**
 * Blob URLs inherit the application's origin. Only inert media may be opened
 * in a top-level blob document; HTML, SVG/XML, PDFs, and unknown formats are
 * downloaded with an inert MIME instead so uploaded content cannot execute
 * with access to the AppFlowy origin.
 */
function canOpenBlobInline(blob: Blob): boolean {
  const mime = blob.type.split(';', 1)[0].trim().toLowerCase();

  if (!mime) return false;
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return true;

  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}

function downloadInertBlob(blob: Blob, filename?: string): void {
  const inertBlob = blob.slice(0, blob.size, 'application/octet-stream');

  download(inertBlob, filename || 'attachment');
}

export function downloadBlob(blob: Blob, filename: string): void {
  download(blob, filename);
}

export async function downloadFile(url: string, filename?: string): Promise<void> {
  try {
    const response = await fetchFile(url);

    if (!response.ok) {
      throw new Error(`Download failed, the download status is: ${response.status}`);
    }

    const blob = await response.blob();

    download(blob, filename);
  } catch (error) {
    console.error(error);
  }
}

/**
 * Open a file while preserving bearer authentication on AppFlowy's protected
 * file routes. A direct `window.open` cannot attach Authorization and would
 * turn accepted public-form attachments into a 401 page.
 */
export async function openFileUrl(url: string, target = '_blank', filename?: string): Promise<void> {
  if (!isAppFlowyAuthenticatedFileUrl(url)) {
    await openUrl(url, target, target === '_blank' ? 'noopener,noreferrer' : undefined);
    return;
  }

  // Open synchronously from the click event so popup blockers do not reject
  // the eventual blob navigation after the authenticated fetch completes.
  const popup = window.open('', target);

  if (!popup) return;
  const ownsPopup = target === '_blank';

  // A subsequently-loaded document must never retain a reference to the app.
  // This is defense in depth for the inert MIME allowlist below.
  if (ownsPopup) popup.opener = null;

  try {
    const response = await fetchFile(url);

    if (!response.ok) {
      throw new Error(`Open failed, the download status is: ${response.status}`);
    }

    const blob = await response.blob();

    if (!canOpenBlobInline(blob)) {
      if (ownsPopup) popup.close();
      downloadInertBlob(blob, filename);
      return;
    }

    const blobUrl = URL.createObjectURL(blob);

    popup.location.href = blobUrl;
    // Keep the capability alive long enough for the new tab to consume it,
    // while still releasing the potentially large blob deterministically.
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (error) {
    if (ownsPopup) popup.close();
    console.error(error);
  }
}

async function fetchFile(url: string): Promise<Response> {
  if (!isAppFlowyAuthenticatedFileUrl(url)) return fetch(url);

  const token = getTokenParsed();
  const requiresMemberAuth = isAppFlowyPublicFormUploadUrl(url);

  if (requiresMemberAuth && !token) {
    throw new Error('Authentication required for AppFlowy file download');
  }

  // Regular /api/file_storage URLs may be readable anonymously on published
  // and template pages. Preserve that path for logged-out viewers.
  if (!token) return fetch(url);

  const authenticated = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'x-platform': 'web-app',
    },
  });

  // A stale session must not break an otherwise public legacy file. Durable
  // form uploads are intentionally member-only, so never retry those without
  // the bearer token.
  if (isAppFlowyFileStorageUrl(url) && (authenticated.status === 401 || authenticated.status === 403)) {
    return fetch(url);
  }

  return authenticated;
}
