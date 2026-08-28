import { useEffect, useRef, useState } from 'react';

import { getImageUrl, revokeBlobUrl } from '@/utils/authenticated-image';

/**
 * Resolve a (possibly auth-protected) file-storage URL into something an <img> can render.
 * Mirrors what <AvatarImage> does internally, for the banner images which are plain <img>/background.
 */
export function useAuthenticatedImage(src: string | null | undefined): string {
  const [resolved, setResolved] = useState('');
  const blobUrlRef = useRef('');

  useEffect(() => {
    if (!src) {
      setResolved('');
      return;
    }

    let mounted = true;

    void getImageUrl(src)
      .then((url) => {
        if (!mounted) {
          if (url) revokeBlobUrl(url);
          return;
        }

        setResolved(url);
        blobUrlRef.current = url;
      })
      .catch(() => {
        if (mounted) setResolved('');
      });

    return () => {
      mounted = false;
      if (blobUrlRef.current) {
        revokeBlobUrl(blobUrlRef.current);
        blobUrlRef.current = '';
      }
    };
  }, [src]);

  return resolved;
}

export default useAuthenticatedImage;
