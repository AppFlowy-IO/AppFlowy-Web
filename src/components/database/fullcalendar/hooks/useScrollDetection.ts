import { useCallback, useEffect, useRef } from 'react';

import { getScrollParent } from '@/components/global-comment/utils';

export const useScrollDetection = (containerRef: React.RefObject<HTMLDivElement>, buttonRef: React.RefObject<HTMLButtonElement>) => {
  const showTimeoutRef = useRef<number | null>(null);

  const getScrollElement = useCallback(() => {
    if (!containerRef.current) return null;
    return containerRef.current.closest('.appflowy-scroll-container') || getScrollParent(containerRef.current);
  }, [containerRef]);


  useEffect(() => {
    const scrollElement = getScrollElement();

    if (scrollElement) {
      const handleScroll = () => {
        buttonRef.current?.style.setProperty('opacity', '0');
        buttonRef.current?.style.setProperty('pointer-events', 'none');

        if (showTimeoutRef.current !== null) {
          window.clearTimeout(showTimeoutRef.current);
        }

        showTimeoutRef.current = window.setTimeout(() => {
          buttonRef.current?.style.setProperty('opacity', '1');
          buttonRef.current?.style.setProperty('pointer-events', 'auto');
          showTimeoutRef.current = null;
        }, 1000);
      };

      const scrollListenerOptions: AddEventListenerOptions = { passive: true };

      scrollElement.addEventListener('scroll', handleScroll, scrollListenerOptions);

      return () => {
        if (showTimeoutRef.current !== null) {
          window.clearTimeout(showTimeoutRef.current);
          showTimeoutRef.current = null;
        }

        scrollElement.removeEventListener('scroll', handleScroll, scrollListenerOptions);
      };
    }
  }, [getScrollElement, buttonRef]);
};
