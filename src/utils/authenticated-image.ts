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
 * Cleans up a blob URL created by fetchAuthenticatedImage
 * Should be called when the component unmounts or the URL is no longer needed
 *
 * @param url - The blob URL to revoke
 */
export function revokeBlobUrl(url: string): void {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}
