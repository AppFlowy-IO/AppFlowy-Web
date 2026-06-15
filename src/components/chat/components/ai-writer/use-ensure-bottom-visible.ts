import throttle from 'lodash-es/throttle';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApplyingState, useWriterContext } from '@/components/chat/writer/context';

const SCROLL_CONFIG = {
  // Offset to ensure the bottom is visible
  OFFSET: 150,
  // Delay to throttle the scroll event
  DELAY: 50,
  // Delay to prevent auto scroll when user is scrolling
  PREVENT_SCROLL_DELAY: 150,
};

function useEnsureBottomVisible() {
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const isUserScrollingRef = useRef(false);
  const {
    placeholderContent,
    scrollContainer,
    hasAIAnswer,
    applyingState,
  } = useWriterContext();

  const enableAutoScroll = useCallback(() => {
    isUserScrollingRef.current = false;
    setIsAutoScrollEnabled(true);
  }, []);

  const applyingStateRef = useRef(applyingState);

  useEffect(() => {
    applyingStateRef.current = applyingState;
    if(applyingState === ApplyingState.idle) {
      enableAutoScroll();
    }
  }, [applyingState, enableAutoScroll]);

  const getTarget = useCallback(() => {
    return document.querySelector('.writer-anchor');
  }, []);

  const scrollToBottom = useCallback((container: HTMLElement) => {
    const containerRect = container.getBoundingClientRect();
    const rect = document.querySelector('.writer-anchor')?.getBoundingClientRect();

    if(!rect) return;

    const offset = rect.bottom - containerRect.bottom;

    if(offset < 0) return;

    container.scrollTo({
      top: container.scrollTop + offset + SCROLL_CONFIG.OFFSET,
      behavior: 'smooth',
    });
  }, []);

  const scrollIntoView = useMemo(() => {
    return throttle(() => {
      const target = getTarget();

      if(!scrollContainer || !target || isUserScrollingRef.current) return;

      scrollToBottom(scrollContainer);

    }, SCROLL_CONFIG.DELAY);
  }, [getTarget, scrollContainer, scrollToBottom]);

  const handleScroll = useCallback((event: WheelEvent) => {
    const target = getTarget();

    if(!isAutoScrollEnabled || !target) return;

    if([ApplyingState.analyzing, ApplyingState.applying].includes(applyingStateRef.current)) {
      isUserScrollingRef.current = true;
      if(event.deltaY < -50) {
        console.error('User is scrolling, disabling auto scroll', event.deltaY);
        setIsAutoScrollEnabled(false);
      } else {
        isUserScrollingRef.current = false;
      }
    }

  }, [getTarget, isAutoScrollEnabled]);

  useEffect(() => {
    if(!isAutoScrollEnabled) return;

    scrollContainer?.addEventListener('wheel', handleScroll, { passive: true });

    window.addEventListener('wheel', handleScroll, { passive: true });

    return () => {
      scrollContainer?.removeEventListener('wheel', handleScroll);
      window.removeEventListener('wheel', handleScroll);

    };
  }, [handleScroll, isAutoScrollEnabled, scrollContainer]);

  useEffect(() => {
    const target = getTarget();

    if(!placeholderContent || !target) {
      return;
    }

    if(isAutoScrollEnabled && ([ApplyingState.analyzing, ApplyingState.applying, ApplyingState.completed].includes(applyingState))) {
      const rect = target.getBoundingClientRect();
      const viewportRect = scrollContainer?.getBoundingClientRect();

      if(viewportRect && rect.bottom > viewportRect.bottom) {
        scrollIntoView();
      }

    }
  }, [getTarget, isAutoScrollEnabled, placeholderContent, scrollContainer, scrollIntoView, applyingState]);

  useEffect(() => {
    if(!placeholderContent && hasAIAnswer()) {
      enableAutoScroll();
    }
  }, [hasAIAnswer, enableAutoScroll, placeholderContent]);

  return {
    isAutoScrollEnabled,
    enableAutoScroll,
    disableAutoScroll: () => setIsAutoScrollEnabled(false),
  };
}

export default useEnsureBottomVisible;