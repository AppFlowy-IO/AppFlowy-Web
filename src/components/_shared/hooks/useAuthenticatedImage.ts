import { useEffect, useState } from 'react';

import { getImageUrl, revokeBlobUrl } from '@/utils/authenticated-image';
import { isAppFlowyPublicFormUploadUrl } from '@/utils/file-storage-url';
import { Log } from '@/utils/log';

/**
 * Hook to handle authenticated image loading for AppFlowy file storage URLs
 * Returns the authenticated blob URL or the original URL if authentication is not needed
 *
 * @param src - The image source URL
 * @returns The authenticated image URL (blob URL) or original URL
 */
export function useAuthenticatedImage(src: string | undefined): string {
  const [resolved, setResolved] = useState({ source: '', url: '' });

  useEffect(() => {
    if (!src) {
      setResolved({ source: '', url: '' });
      return;
    }

    let isMounted = true;
    let blobUrl = '';

    setResolved({ source: src, url: '' });

    Log.debug('[useAuthenticatedImage] src', isAppFlowyPublicFormUploadUrl(src) ? '[public-form-attachment]' : src);
    getImageUrl(src)
      .then((url) => {
        if (isMounted) {
          blobUrl = url;
          setResolved({ source: src, url });
        } else {
          revokeBlobUrl(url);
        }
      })
      .catch((error) => {
        console.error('Failed to load authenticated image:', error);
        if (isMounted) {
          setResolved({ source: src, url: '' });
        }
      });

    return () => {
      isMounted = false;
      // Clean up blob URL if it was created
      revokeBlobUrl(blobUrl);
    };
  }, [src]);

  // A resolved URL belongs to the source that requested it, including during render.
  const authenticatedSrc = resolved.source === src ? resolved.url : '';

  // Accepted form attachments are never anonymously readable. Keep their
  // protected route out of `<img src>` while the bearer fetch is pending (or
  // when no session exists), otherwise the browser emits a guaranteed 401.
  if (src && isAppFlowyPublicFormUploadUrl(src)) return authenticatedSrc;

  return authenticatedSrc || src || '';
}
