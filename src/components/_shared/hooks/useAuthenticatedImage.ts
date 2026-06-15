import { useEffect, useRef, useState } from 'react';

import { getImageUrl, revokeBlobUrl } from '@/utils/authenticated-image';
import { Log } from '@/utils/log';

/**
 * Hook to handle authenticated image loading for AppFlowy file storage URLs
 * Returns the authenticated blob URL or the original URL if authentication is not needed
 *
 * @param src - The image source URL
 * @returns The authenticated image URL (blob URL) or original URL
 */
export function useAuthenticatedImage(src: string | undefined): string {
    const [authenticatedSrc, setAuthenticatedSrc] = useState<string>('');
    const blobUrlRef = useRef<string>('');

    useEffect(() => {
        if (!src) {
            setAuthenticatedSrc('');
            return;
        }

        let isMounted = true;

        Log.debug('[useAuthenticatedImage] src', src);
        getImageUrl(src)
            .then((url) => {
                if (isMounted) {
                    setAuthenticatedSrc(url);
                    blobUrlRef.current = url;
                }
            })
            .catch((error) => {
                console.error('Failed to load authenticated image:', error);
                if (isMounted) {
                    setAuthenticatedSrc('');
                }
            });

        return () => {
            isMounted = false;
            // Clean up blob URL if it was created
            if (blobUrlRef.current && blobUrlRef.current.startsWith('blob:')) {
                revokeBlobUrl(blobUrlRef.current);
                blobUrlRef.current = '';
            }
        };
    }, [src]);

    return authenticatedSrc || src || '';
}

