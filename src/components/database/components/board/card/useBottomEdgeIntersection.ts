import { useEffect, useState } from 'react';

import { Log } from '@/utils/log';

export function useBottomEdgeIntersection(element: HTMLDivElement | null, gap = 40) {
  const [isBottomTouching, setIsBottomTouching] = useState(false);

  useEffect(() => {
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries[0]?.isIntersecting || false;

        Log.debug('IntersectionObserver', isIntersecting);
        setIsBottomTouching(isIntersecting);
      },
      {
        rootMargin: `0px 0px -${gap}px 0px`,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [element, gap]);

  return {
    isBottomTouching,
  };
}
