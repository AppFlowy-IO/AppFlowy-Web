import { useCallback } from 'react';

import { SCROLL_DELAY, SCROLL_FALLBACK_DELAY } from './constants';

export const useDatabaseViewNavigation = (
  tabRefs: React.MutableRefObject<Map<string, HTMLElement>>,
  setSelectedViewId?: (viewId: string) => void
) => {
  const scrollToView = useCallback(
    (viewId: string) => {
      const element = tabRefs.current.get(viewId);

      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
        return true;
      }

      return false;
    },
    [tabRefs]
  );

  const navigateToView = useCallback(
    async (viewId: string) => {
      // Select the new view - this should trigger the tab to become active
      if (setSelectedViewId) {
        setSelectedViewId(viewId);
      }

      // Wait a bit for React to process the selection update and render the new tab
      await new Promise((resolve) => setTimeout(resolve, SCROLL_DELAY));

      // Try to scroll to the view
      const scrolled = scrollToView(viewId);

      if (!scrolled) {
        // Fallback: try scrolling after a longer delay if the element wasn't ready
        setTimeout(() => {
          scrollToView(viewId);
        }, SCROLL_FALLBACK_DELAY);
      }
    },
    [setSelectedViewId, scrollToView]
  );

  return { navigateToView };
};

