import { getTokenParsed } from '@/application/session/token';
import { isAppFlowyFileStorageUrl } from '@/utils/file-storage-url';
import { getConfigValue } from '@/utils/runtime-config';

const resolveImageUrl = (url: string): string => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${getConfigValue('APPFLOWY_BASE_URL', '')}${url}`;
};

export const checkImage = async (url: string) => {
  return new Promise((resolve: (data: {
    ok: boolean,
    status: number,
    statusText: string,
    error?: string,
    validatedUrl?: string,
  }) => void) => {
    // If it's an AppFlowy file storage URL, use authenticated fetch
    if (isAppFlowyFileStorageUrl(url)) {
      const token = getTokenParsed();

      if (!token) {
        resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          error: 'No authentication token available',
        });
        return;
      }

      const fullUrl = resolveImageUrl(url);

      fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      })
        .then((response) => {
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
            resolve({
              ok: false,
              status: response.status,
              statusText: response.statusText,
              error: `Failed to fetch image: ${response.statusText}`,
            });
          }
        })
        .catch((error) => {
          resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Error',
            error: error.message || 'Failed to fetch image',
          });
        });
      return;
    }

    // For non-AppFlowy URLs, use the original Image() approach
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
        validatedUrl: url,
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

    img.src = url;
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