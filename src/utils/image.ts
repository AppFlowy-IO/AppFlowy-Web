import { getTokenParsed } from '@/application/session/token';
import { isAppFlowyFileStorageUrl } from '@/utils/file-storage-url';
import { Log } from '@/utils/log';
import { getConfigValue } from '@/utils/runtime-config';

const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const TIFF_MIME_TYPES = new Set(['image/tiff', 'image/tif', 'image/x-tiff']);
const HEIC_EXT_REGEX = /\.(heic|heif)(\?.*)?$/i;
const TIFF_EXT_REGEX = /\.(tiff?)(\?.*)?$/i;

const isHeicBlob = (blob: Blob, url?: string): boolean => {
  if (HEIC_MIME_TYPES.has(blob.type)) return true;
  return !!url && HEIC_EXT_REGEX.test(url);
};

const isTiffBlob = (blob: Blob, url?: string): boolean => {
  if (TIFF_MIME_TYPES.has(blob.type)) return true;
  return !!url && TIFF_EXT_REGEX.test(url);
};

/**
 * Browsers (other than Safari) cannot decode HEIC/HEIF or TIFF natively.
 * Transcode such blobs to PNG client-side so a regular <img> can render them.
 */
export const transcodeIfUnsupported = async (blob: Blob, url?: string): Promise<Blob> => {
  try {
    if (isHeicBlob(blob, url)) {
      const heic2any = (await import('heic2any')).default;
      const result = await heic2any({ blob, toType: 'image/png' });

      return Array.isArray(result) ? result[0] : result;
    }

    if (isTiffBlob(blob, url)) {
      const utifMod = await import('utif');
      const UTIF = ((utifMod as unknown) as { default?: typeof import('utif') }).default ?? utifMod;
      const arrayBuffer = await blob.arrayBuffer();
      const ifds = UTIF.decode(arrayBuffer);

      if (!ifds.length) {
        throw new Error('No image frames found in TIFF');
      }

      UTIF.decodeImage(arrayBuffer, ifds[0]);
      const rgba = UTIF.toRGBA8(ifds[0]);
      const { width, height } = ifds[0];
      const canvas = document.createElement('canvas');

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) throw new Error('Failed to get canvas context');
      const clamped = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
      const imageData = new ImageData(clamped, width, height);

      ctx.putImageData(imageData, 0, 0);

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((pngBlob) => {
          if (pngBlob) resolve(pngBlob);
          else reject(new Error('Failed to encode TIFF as PNG'));
        }, 'image/png');
      });
    }
  } catch (error) {
    Log.error('Failed to transcode unsupported image format', error);
  }

  return blob;
};

const resolveImageUrl = (url: string): string => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${getConfigValue('APPFLOWY_BASE_URL', '')}${url}`;
};


interface CheckImageResult {
  ok: boolean;
  status: number;
  statusText: string;
  error?: string;
  validatedUrl?: string;
}

// Helper function to check image using Image() approach
const validateImageLoad = (imageUrl: string): Promise<CheckImageResult> => {
  return new Promise((resolve) => {
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
  });
};

const validateImageBlob = async (blob: Blob, url?: string): Promise<Blob | null> => {
  // Check if the response is actually JSON (e.g. error message with 200 status)
  if (blob.type === 'application/json') {
    try {
      const text = await blob.text();

      Log.error('Image fetch returned JSON instead of image:', text);
    } catch (e) {
      Log.error('Image fetch returned JSON blob');
    }

    return null;
  }

  let normalizedBlob = blob;

  // If the blob type is generic or missing, try to infer from URL
  if ((!normalizedBlob.type || normalizedBlob.type === 'application/octet-stream') && url) {
    const inferredType = getMimeTypeFromUrl(url);

    if (inferredType) {
      normalizedBlob = normalizedBlob.slice(0, normalizedBlob.size, inferredType);
    }
  }

  return transcodeIfUnsupported(normalizedBlob, url);
};

export const checkImage = async (url: string): Promise<CheckImageResult> => {
  // If it's an AppFlowy file storage URL, try authenticated fetch first
  if (isAppFlowyFileStorageUrl(url)) {
    const token = getTokenParsed();
    const fullUrl = resolveImageUrl(url);

    Log.debug('[checkImage] fullUrl', fullUrl);

    if (token) {
      try {
        const response = await fetch(fullUrl, {
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            'x-platform': 'web-app',
          },
        });

        if (response.ok) {
          const blob = await response.blob();
          const validatedBlob = await validateImageBlob(blob, url);

          if (!validatedBlob) {
            return {
              ok: false,
              status: 406, // Not Acceptable
              statusText: 'Not Acceptable',
              error: 'Image fetch returned JSON instead of image',
            };
          }

          const blobUrl = URL.createObjectURL(validatedBlob);

          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            validatedUrl: blobUrl,
          };
        }

        console.error('Authenticated image fetch failed', response.status, response.statusText);
      } catch (error) {
        console.error('Failed to fetch authenticated image', error);
      }
    }

    // Fallback for no token or failed fetch
    return validateImageLoad(fullUrl);
  }

  // For non-AppFlowy URLs, use the original Image() approach
  return validateImageLoad(url);
};

export const fetchImageBlob = async (url: string): Promise<Blob | null> => {
  if (isAppFlowyFileStorageUrl(url)) {
    Log.debug('[fetchImageBlob] url', url);
    const token = getTokenParsed();

    if (!token) {
      Log.error('No authentication token available for image fetch');
      return null;
    }

    const fullUrl = resolveImageUrl(url);

    try {
      const response = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'x-platform': 'web-app',
        },
      });

      if (response.ok) {
        const blob = await response.blob();

        return validateImageBlob(blob, url);
      }
    } catch (error) {
      return null;
    }
  } else {
    try {
      const response = await fetch(url);

      if (response.ok) {
        let blob = await response.blob();

        // If the blob type is generic or missing, try to infer from URL
        if ((!blob.type || blob.type === 'application/octet-stream') && url) {
          const inferredType = getMimeTypeFromUrl(url);

          if (inferredType) {
            blob = blob.slice(0, blob.size, inferredType);
          }
        }

        return transcodeIfUnsupported(blob, url);
      }
    } catch (error) {
      return null;
    }
  }

  return null;
};

export const convertBlobToPng = async (blob: Blob): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      const canvas = document.createElement('canvas');

      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob);
        } else {
          reject(new Error('Failed to convert to PNG'));
        }

        URL.revokeObjectURL(url);
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for conversion'));
    };

    img.src = url;
  });
};

const getMimeTypeFromUrl = (url: string): string | null => {
  // Handle data URLs
  if (url.startsWith('data:')) {
    return url.split(';')[0].split(':')[1];
  }

  const cleanUrl = url.split('?')[0];
  const ext = cleanUrl.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    default:
      return null;
  }
};
