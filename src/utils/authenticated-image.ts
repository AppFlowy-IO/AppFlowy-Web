import { getTokenParsed } from '@/application/session/token';
import { isAppFlowyFileStorageUrl } from '@/utils/file-storage-url';
import { Log } from '@/utils/log';
import { getConfigValue } from '@/utils/runtime-config';

const resolveImageUrl = (url: string): string => {
  if (!url) return '';

  return url.startsWith('http') ? url : `${getConfigValue('APPFLOWY_BASE_URL', '')}${url}`;
};

/**
 * Fetches an image with authentication headers and converts it to a blob URL
 * Used for loading AppFlowy file storage images that require authentication
 *
 * @param url - The image URL to fetch
 * @returns A promise that resolves to a blob URL or null if fetch fails
 */
export async function fetchAuthenticatedImage(url: string, token = getTokenParsed()): Promise<string | null> {
  if (!url) return null;

  try {
    const authToken = token ?? getTokenParsed();

    if (!authToken) {
      console.warn('No authentication token available for image fetch');
      return null;
    }

    // Construct full URL if it's a relative path
    const fullUrl = resolveImageUrl(url);

    const response = await fetch(fullUrl, {
      headers: {
        Authorization: `Bearer ${authToken.access_token}`,
        'x-platform': 'web-app',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch authenticated image:', response.status, response.statusText);
      return null;
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    return blobUrl;
  } catch (error) {
    console.error('Error fetching authenticated image:', error);
    return null;
  }
}

/**
 * Processes an image URL, fetching with authentication if needed
 * Returns the URL directly if it doesn't require authentication
 *
 * @param url - The image URL to process
 * @returns A promise that resolves to a usable image URL
 */
export async function getImageUrl(url: string | undefined): Promise<string> {
  if (!url) return '';
  Log.debug('[getImageUrl] url', url);

  // If it's an AppFlowy file storage URL, fetch with authentication
  if (isAppFlowyFileStorageUrl(url)) {
    const token = getTokenParsed();

    if (!token) {
      // Allow browser to load publicly-accessible URLs without authentication
      return resolveImageUrl(url);
    }

    const blobUrl = await fetchAuthenticatedImage(url, token);

    return blobUrl || '';
  }

  // For other URLs (emojis, external images, data URLs), return as-is
  return url;
}

/**
 * Cleans up a blob URL created by fetchAuthenticatedImage.
 *
 * ## Why this is needed
 *
 * When `fetchAuthenticatedImage` fetches an image with auth headers, it creates
 * a Blob URL using `URL.createObjectURL()`. This URL holds a reference to the
 * binary image data in browser memory.
 *
 * The browser keeps this data alive as long as the Blob URL exists - even if:
 * - The `<img>` element is removed from the DOM
 * - The React component unmounts
 * - The URL is no longer referenced anywhere in code
 *
 * Without calling `revokeBlobUrl`, each authenticated image fetch causes a
 * memory leak. For example, browsing 100 pages with 1MB icon images would
 * accumulate ~100MB in memory that is never freed until page reload.
 *
 * ## Usage
 *
 * Call this function in a useEffect cleanup when the component unmounts
 * or when the image URL changes:
 *
 * ```tsx
 * useEffect(() => {
 *   let blobUrl: string | undefined;
 *   getImageUrl(url).then((result) => {
 *     blobUrl = result;
 *     setImgSrc(result);
 *   });
 *   return () => {
 *     if (blobUrl) revokeBlobUrl(blobUrl);
 *   };
 * }, [url]);
 * ```
 *
 * @param url - The blob URL to revoke. Safe to call with non-blob URLs (no-op).
 */
export function revokeBlobUrl(url: string): void {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}
