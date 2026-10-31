import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface UseTabScrollerOptions {
  /**
   * Called on mount and whenever the strip's scroll container is resized,
   * from the one observer the scroll buttons already use.
   */
  onResize?: (scroller: HTMLDivElement) => void;
}

export const useTabScroller = ({ onResize }: UseTabScrollerOptions = {}) => {
  const [scrollerContainer, setScrollerContainer] = useState<HTMLDivElement | null>(null);
  const [showScrollRightButton, setShowScrollRightButton] = useState(false);
  const [showScrollLeftButton, setShowScrollLeftButton] = useState(false);
  const onResizeRef = useRef(onResize);

  useLayoutEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const handleObserverScroller = useCallback(() => {
    if (scrollerContainer) {
      const scrollWidth = scrollerContainer.scrollWidth;
      const clientWidth = scrollerContainer.clientWidth;

      setShowScrollRightButton(
        scrollWidth > clientWidth && scrollerContainer.scrollLeft + 1 < scrollWidth - clientWidth
      );
      setShowScrollLeftButton(scrollerContainer.scrollLeft > 5);
    }
  }, [scrollerContainer]);

  useEffect(() => {
    if (!scrollerContainer) return;
    const handleResize = () => {
      onResizeRef.current?.(scrollerContainer);
      handleObserverScroller();
    };

    // Initial call
    handleResize();

    const observer = new ResizeObserver(handleResize);

    observer.observe(scrollerContainer);

    return () => {
      observer.disconnect();
    };
  }, [handleObserverScroller, scrollerContainer]);

  const scrollLeft = useCallback(() => {
    if (scrollerContainer) {
      scrollerContainer.scrollTo({
        left: scrollerContainer.scrollLeft - 200,
        behavior: 'smooth',
      });
    }
  }, [scrollerContainer]);

  const scrollRight = useCallback(() => {
    if (scrollerContainer) {
      scrollerContainer.scrollTo({
        left: scrollerContainer.scrollLeft + 200,
        behavior: 'smooth',
      });
    }
  }, [scrollerContainer]);

  return {
    setScrollerContainer,
    showScrollLeftButton,
    showScrollRightButton,
    scrollLeft,
    scrollRight,
    handleObserverScroller,
  };
};
