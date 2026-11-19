import { useEffect, useState } from 'react';

import { appflowyLinkPreviewProvider } from '@/utils/link-preview-remote';

// Public links use AppFlowy's own unfurler, just as desktop reads page metadata.
// Never send connected-account files to a third-party preview service.
export function useDriveLinkName(url: string | undefined) {
  const [result, setResult] = useState<{ url: string; name: string }>();

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();

    void appflowyLinkPreviewProvider
      .fetch({
        normalizedUrl: url,
        parsedUrl: new URL(url),
        fallbackData: { title: '', description: '' },
        signal: controller.signal,
      })
      .then((metadata) => {
        const name = metadata?.title?.trim();

        if (
          !controller.signal.aborted &&
          name &&
          !/^(Sign in|Google Drive|Google Docs|Google Sheets|Google Slides|docs\.google\.com|drive\.google\.com)(\s*[-–].*)?$/i.test(
            name
          )
        )
          setResult({ url, name });
      })
      .catch(() => {
        /* Metadata is optional; the embedded Google viewer remains usable. */
      });
    return () => controller.abort();
  }, [url]);
  return result?.url === url ? result?.name : undefined;
}
