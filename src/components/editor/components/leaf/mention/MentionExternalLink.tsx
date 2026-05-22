import React, { useEffect } from 'react';

import { buildFallbackLinkPreviewData, fetchLinkPreviewData, LinkPreviewData } from '@/utils/link-preview';

interface RemoteLinkPreviewData {
  data: LinkPreviewData;
  url: string;
}

function MentionExternalLink ({
  url,
}: {
  url: string;
}) {
  const fallbackData = React.useMemo(() => buildFallbackLinkPreviewData(url), [url]);
  const [remotePreview, setRemotePreview] = React.useState<RemoteLinkPreviewData | null>(null);
  const data = remotePreview && remotePreview.url === url ? remotePreview.data : fallbackData;

  useEffect(() => {
    const controller = new AbortController();

    setRemotePreview(null);
    void fetchLinkPreviewData(url, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRemotePreview({ url, data });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRemotePreview(null);
        }
      });

    return () => controller.abort();
  }, [url]);

  const imageUrl = data.logo?.url || data.image?.url;

  return (
    <span
      onClick={() => {
        window.open(url, '_blank');
      }}
      className={'cursor-pointer inline-flex gap-1.5 text-text-primary hover:underline'}
    >
      {imageUrl && (
        <span className={'mt-0.5'}>
          <img
            className={'object-cover w-5 h-5'}
            src={imageUrl}
            alt={data.title}
          />
        </span>
      )}
      <span className={'leading-[24px]'}>{data.title || url}</span>
    </span>
  );
}

export default MentionExternalLink;
