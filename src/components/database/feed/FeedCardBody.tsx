import { ReactNode, RefObject, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as FullViewIcon } from '@/assets/icons/full_screen.svg';
import { cn } from '@/lib/utils';

// The Figma `Mask`: the last 20px of clipped content fade into the card.
const CLIPPED_CONTENT_STYLE: React.CSSProperties = {
  maskImage: 'linear-gradient(to bottom, #000 calc(100% - 20px), transparent)',
  WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 20px), transparent)',
};

/** True while `content` is taller than the `clip` box the card's height cap leaves it. */
function useClippedContent(clipRef: RefObject<HTMLElement>, contentRef: RefObject<HTMLElement>): boolean {
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const clip = clipRef.current;
    const content = contentRef.current;

    if (!clip || !content) return;

    const measure = () => {
      setClipped(content.offsetHeight > clip.clientHeight + 1);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;

    // The clip shrinks when the footer grows (a multi-line comment draft);
    // the content grows when the row document hydrates.
    const observer = new ResizeObserver(measure);

    observer.observe(clip);
    observer.observe(content);

    return () => observer.disconnect();
  }, [clipRef, contentRef]);

  return clipped;
}

/** The Figma `Outline Button` floating over clipped content. */
function OpenAsFullPageButton({ onClick, rowId }: { onClick: () => void; rowId: string }) {
  const { t } = useTranslation();

  return (
    <button
      className={cn(
        'absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-200 border border-border-primary',
        'bg-surface-layer-04 px-2 py-1 text-sm font-medium leading-5 text-text-primary shadow-menu transition-colors hover:bg-surface-layer-04-hover',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
      )}
      data-feed-interactive='true'
      data-testid={`feed-card-open-full-page-${rowId}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      type='button'
    >
      <FullViewIcon aria-hidden='true' className='h-5 w-5 text-icon-primary' />
      {t('grid.rowPage.openAsFullPage')}
    </button>
  );
}

/**
 * The Figma feed card `Body`: title, properties and document preview. It
 * absorbs whatever height the card's cap leaves after the header and footer;
 * content taller than that is clipped behind a fade, and "Open as full page"
 * replaces the old in-place "See more".
 */
export function FeedCardBody({
  children,
  className,
  onOpenFullPage,
  rowId,
}: {
  children: ReactNode;
  className?: string;
  onOpenFullPage?: () => void;
  rowId: string;
}) {
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const clipped = useClippedContent(clipRef, contentRef);

  return (
    <div
      className={cn('relative flex min-h-0 flex-col px-8 pb-3 max-sm:px-4', className)}
      data-clipped={clipped}
      data-testid={`feed-card-body-${rowId}`}
    >
      <div className='min-h-0 overflow-hidden' ref={clipRef} style={clipped ? CLIPPED_CONTENT_STYLE : undefined}>
        <div className='flex flex-col gap-3' ref={contentRef}>
          {children}
        </div>
      </div>

      {clipped && onOpenFullPage ? <OpenAsFullPageButton onClick={onOpenFullPage} rowId={rowId} /> : null}
    </div>
  );
}

export default FeedCardBody;
