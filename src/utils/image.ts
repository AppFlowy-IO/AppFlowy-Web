import { getTokenParsed } from '@/application/session/token';
import { isAppFlowyFileStorageUrl } from '@/utils/file-storage-url';
import { getConfigValue } from '@/utils/runtime-config';

const resolveImageUrl = (url: string): string => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${getConfigValue('APPFLOWY_BASE_URL', '')}${url}`;
};

// Helper function to check image using Image() approach
const checkImageWithImageElement = (
  imageUrl: string,
  resolve: (data: {
    ok: boolean,
    status: number,
    statusText: string,
    error?: string,
    validatedUrl?: string,
  }) => void
) => {
  const img = new Image();

  // Set a timeout to handle very slow loads
  const timeoutId = setTimeout(() => {
    resolve({
      ok: false,
      status: 408,
      statusText: 'Request Timeout',
      error: 'Image loading timed out',
    });
  }, 10000); // 10 second timeout

  img.onload = () => {
    clearTimeout(timeoutId);
    resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      validatedUrl: imageUrl,
    });
  };

  img.onerror = () => {
    clearTimeout(timeoutId);
    resolve({
      ok: false,
      status: 404,
      statusText: 'Image Not Found',
      error: 'Failed to load image',
    });
  };

  img.src = imageUrl;
};

export const checkImage = async (url: string) => {
  return new Promise((resolve: (data: {
    ok: boolean,
    status: number,
    statusText: string,
    error?: string,
    validatedUrl?: string,
  }) => void) => {
    // If it's an AppFlowy file storage URL, try authenticated fetch first
    if (isAppFlowyFileStorageUrl(url)) {
      const token = getTokenParsed();

      if (!token) {
        // Allow browser to load publicly-accessible URLs without authentication
        // Fall through to Image() approach with resolved URL
        const resolvedUrl = resolveImageUrl(url);

        checkImageWithImageElement(resolvedUrl, resolve);
        return;
      }

      const fullUrl = resolveImageUrl(url);

      fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      })
        .then((response) => {
          console.debug("fetchImageBlob response", response);
          if (response.ok) {
            // Convert to blob URL for use in img tag
            return response.blob().then((blob) => {
              const blobUrl = URL.createObjectURL(blob);

              resolve({
                ok: true,
                status: 200,
                statusText: 'OK',
                validatedUrl: blobUrl,
              });
            });
          } else {
            console.error('Authenticated image fetch failed', response.status, response.statusText);
            // If authenticated fetch fails, fall back to Image() approach
            // This allows publicly-accessible URLs to still work
            checkImageWithImageElement(fullUrl, resolve);
          }
        })
        .catch((error) => {
          console.error('Failed to fetch authenticated image', error);
          // If fetch throws an error (CORS, network, etc.), fall back to Image() approach
          checkImageWithImageElement(fullUrl, resolve);
        });
      return;
    }

    // For non-AppFlowy URLs, use the original Image() approach
    checkImageWithImageElement(url, resolve);
  });
};

export const fetchImageBlob = async (url: string): Promise<Blob | null> => {
  if (isAppFlowyFileStorageUrl(url)) {
    const token = getTokenParsed();

    if (!token) return null;

    const fullUrl = resolveImageUrl(url);

    try {
      const response = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      });

      if (response.ok) {
        return await response.blob();
      }
    } catch (error) {
      return null;
    }
  } else {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return await response.blob();
      }
    } catch (error) {
      return null;
    }
  }

  return null;
};