import { debounce } from 'lodash-es';
import { type MouseEvent, memo, useCallback, useEffect, useMemo, useState } from 'react';

import { MentionLinkPreviewCard } from '@/components/editor/components/leaf/mention/MentionLinkPreviewCard';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { buildFallbackLinkPreviewData, fetchLinkPreviewData, LinkPreviewData } from '@/utils/link-preview';
import { openUrl } from '@/utils/url';

interface RemoteLinkPreviewData {
  data: LinkPreviewData;
  url: string;
}

// Memoized: this renders as an editor leaf, which re-renders on every selection
// / typing change. Re-rendering only when `url` changes mirrors the sibling
// Href / LinkPreview components.
const MentionExternalLink = memo(function MentionExternalLink ({
  url,
}: {
  url: string;
}) {
  const fallbackData = useMemo(() => buildFallbackLinkPreviewData(url), [url]);
  const [remotePreview, setRemotePreview] = useState<RemoteLinkPreviewData | null>(null);
  const data = remotePreview && remotePreview.url === url ? remotePreview.data : fallbackData;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Defer the preview fetch until the chip is near the viewport so a document
  // with many link mentions doesn't fire N requests up front. Falls back to
  // eager fetching where IntersectionObserver is unavailable.
  useEffect(() => {
    if (isVisible) return;
    if (!anchor) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(anchor);

    return () => observer.disconnect();
  }, [anchor, isVisible]);

  useEffect(() => {
    if (!isVisible) return;

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
  }, [url, isVisible]);

  // Hover, not click: show the rich preview after a short delay and keep it open
  // while the pointer moves onto the card (matches the desktop hover behaviour).
  const debounceShow = useMemo(() => debounce(() => setOpen(true), 120), []);
  const debounceHide = useMemo(() => debounce(() => setOpen(false), 240), []);

  useEffect(
    () => () => {
      debounceShow.cancel();
      debounceHide.cancel();
    },
    [debounceShow, debounceHide]
  );

  const handleOpenLink = useCallback(() => {
    void openUrl(url, '_blank');
  }, [url]);

  const handleEnter = useCallback(
    (event: MouseEvent) => {
      if (event.buttons > 0) return;
      debounceHide.cancel();
      debounceShow();
    },
    [debounceHide, debounceShow]
  );

  const handleLeave = useCallback(() => {
    debounceShow.cancel();
    debounceHide();
  }, [debounceShow, debounceHide]);

  const imageUrl = data.logo?.url || data.image?.url;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          ref={setAnchor}
          onClick={handleOpenLink}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          className={'cursor-pointer inline-flex gap-1.5 text-text-primary hover:underline'}
        >
          {imageUrl ? (
            <span className={'mt-0.5'}>
              <img className={'object-cover w-5 h-5'} src={imageUrl} alt={data.title} />
            </span>
          ) : null}
          <span className={'leading-[24px]'}>{data.title || url}</span>
        </span>
      </PopoverAnchor>
      {/* Portaled by Radix -> escapes the `td { overflow: hidden }` of simple tables.
          Radix portals bubble events through the React tree, so stop click/mousedown
          here to avoid reaching MentionLeaf's onClick={select} (which would select the
          mention text and pop the toolbar). */}
      <PopoverContent
        side={'top'}
        align={'start'}
        sideOffset={6}
        className={'w-[280px] overflow-hidden p-0'}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseEnter={() => debounceHide.cancel()}
        onMouseLeave={handleLeave}
      >
        <MentionLinkPreviewCard url={url} data={data} onOpen={handleOpenLink} />
      </PopoverContent>
    </Popover>
  );
});

export default MentionExternalLink;
