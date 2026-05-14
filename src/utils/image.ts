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


/**
 * Categorized failure mode for image loads. The polling/retry policy in
 * `Img.tsx` keys off this — different categories deserve different backoff.
 */
export type CheckImageErrorKind =
  | 'no-auth'        // Local: no token yet. Wait briefly; token is hydrating.
  | 'auth-rejected'  // 401 from server. Token expired / invalid. Refresh + retry once.
  | 'forbidden'      // 403 from server. Permission denied. Terminal.
  | 'not-ready'      // 425/503 from server. Upload pipeline still in flight. Fast retry.
  | 'not-found'      // 404 from server. Could still be a slow optimistic upload — slow retry.
  | 'server-error'   // 5xx. Normal retry.
  | 'network'        // fetch threw / timed out / opaque <img> onerror.
  | 'format';        // Successfully fetched but not a usable image blob.

export interface CheckImageResult {
  ok: boolean;
  status: number;
  statusText: string;
  error?: string;
  errorKind?: CheckImageErrorKind;
  validatedUrl?: string;
}

const errorResult = (
  status: number,
  statusText: string,
  errorKind: CheckImageErrorKind,
  error?: string
): CheckImageResult => ({ ok: false, status, statusText, errorKind, error });

const classifyHttpStatus = (status: number): CheckImageErrorKind => {
  if (status === 401) return 'auth-rejected';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 425 || status === 503 || status === 408) return 'not-ready';
  if (status >= 500) return 'server-error';
  return 'network';
};

// Probe a non-AppFlowy URL by attempting to load it via <img>. We can't read
// the HTTP status from a cross-origin <img>, so failures collapse into a
// generic 'network' error — that's fine for the retry policy because it
// doesn't try to distinguish 404 vs 5xx for external hosts anyway.
const validateImageLoad = (imageUrl: string): Promise<CheckImageResult> => {
  return new Promise((resolve) => {
    const img = new Image();

    // Set a timeout to handle very slow loads
    const timeoutId = setTimeout(() => {
      resolve(errorResult(408, 'Request Timeout', 'not-ready', 'Image loading timed out'));
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
      resolve(errorResult(0, 'Image load failed', 'network', 'Failed to load image'));
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
  if (isAppFlowyFileStorageUrl(url)) {
    return checkAppFlowyImage(url);
  }

  // External URL — let the browser do its thing.
  return validateImageLoad(url);
};

/**
 * Fetch an AppFlowy-storage image with auth and turn it into a blob URL the
 * <img> can render.
 *
 * Why not fall back to a plain `<img src>` on failure (as we used to):
 *   - AppFlowy storage requires a Bearer token; an unauthenticated <img>
 *     request is guaranteed to fail (401/403). The browser would then cache
 *     that failure under the URL, so subsequent legitimate retries get the
 *     cached error without ever hitting the server.
 *   - The polling loop in Img.tsx burns retry attempts on guaranteed-failure
 *     requests instead of waiting for a real condition to change (token
 *     becoming available, upload pipeline finishing).
 *
 * Instead, return a typed error so the caller can apply a sensible backoff.
 */
async function checkAppFlowyImage(url: string): Promise<CheckImageResult> {
  const fullUrl = resolveImageUrl(url);

  Log.debug('[checkImage] AppFlowy', fullUrl);

  const token = getTokenParsed();

  if (!token) {
    // Token may still be hydrating from storage. Caller retries shortly.
    return errorResult(401, 'No auth token', 'no-auth');
  }

  let response: Response;

  try {
    response = await fetch(fullUrl, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'x-platform': 'web-app',
      },
      // Don't let the browser cache transient failures (404/425/5xx) — the
      // server now sends `Cache-Control: no-store` on those, but defending
      // against an older server / misbehaving proxy is cheap.
      cache: 'no-store',
    });
  } catch (err) {
    Log.warn('[checkImage] auth fetch network error', err);
    return errorResult(0, 'Network error', 'network', String(err));
  }

  if (!response.ok) {
    return errorResult(
      response.status,
      response.statusText,
      classifyHttpStatus(response.status)
    );
  }

  const blob = await response.blob();
  const validatedBlob = await validateImageBlob(blob, url);

  if (!validatedBlob) {
    return errorResult(
      406,
      'Not Acceptable',
      'format',
      'Image fetch returned JSON instead of image'
    );
  }

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    validatedUrl: URL.createObjectURL(validatedBlob),
  };
}

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
