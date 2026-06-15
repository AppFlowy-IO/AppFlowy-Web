import { renderHook,act } from '@testing-library/react';
import { expect } from '@jest/globals';
import { useDatabaseViewNavigation } from '../useViewNavigation';
import { SCROLL_DELAY, SCROLL_FALLBACK_DELAY } from '../constants';

describe('useDatabaseViewNavigation', () => {
  let mockScrollIntoView: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock scrollIntoView
    mockScrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = mockScrollIntoView;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('navigateToView with element present', () => {
    it('should call scrollIntoView when element exists', async () => {
      const mockElement = document.createElement('div');
      mockElement.scrollIntoView = mockScrollIntoView;

      const tabRefs = { current: new Map([['view-123', mockElement]]) };
      const { result } = renderHook(() =>
        useDatabaseViewNavigation(tabRefs as React.MutableRefObject<Map<string, HTMLElement>>)
      );

      const navigatePromise = result.current.navigateToView('view-123');

      // Run all pending timers (SCROLL_DELAY)
      await act(async () => {
        jest.runAllTimers();
      });

      await navigatePromise;

      expect(mockScrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    });

    it('should call setSelectedViewId before scrolling', async () => {
      const mockElement = document.createElement('div');
      mockElement.scrollIntoView = mockScrollIntoView;

      const tabRefs = { current: new Map([['view-123', mockElement]]) };
      const setSelectedViewId = jest.fn();

      const { result } = renderHook(() =>
        useDatabaseViewNavigation(
          tabRefs as React.MutableRefObject<Map<string, HTMLElement>>,
          setSelectedViewId
        )
      );

      const navigatePromise = result.current.navigateToView('view-123');

      // setSelectedViewId should be called immediately
      expect(setSelectedViewId).toHaveBeenCalledWith('view-123');

      await act(async () => {
        jest.runAllTimers();
      });

      await navigatePromise;
    });

    it('should not throw when setSelectedViewId is undefined', async () => {
      const mockElement = document.createElement('div');
      mockElement.scrollIntoView = mockScrollIntoView;

      const tabRefs = { current: new Map([['view-123', mockElement]]) };

      const { result } = renderHook(() =>
        useDatabaseViewNavigation(tabRefs as React.MutableRefObject<Map<string, HTMLElement>>)
      );

      const navigatePromise = result.current.navigateToView('view-123');

      await act(async () => {
        jest.runAllTimers();
      });

      await expect(navigatePromise).resolves.not.toThrow();
    });

    it('should wait SCROLL_DELAY before scrolling', async () => {
      const mockElement = document.createElement('div');
      mockElement.scrollIntoView = mockScrollIntoView;

      const tabRefs = { current: new Map([['view-123', mockElement]]) };
      const { result } = renderHook(() =>
        useDatabaseViewNavigation(tabRefs as React.MutableRefObject<Map<string, HTMLElement>>)
      );

      result.current.navigateToView('view-123');

      // Should not have scrolled yet
      expect(mockScrollIntoView).not.toHaveBeenCalled();

      // Advance to just before SCROLL_DELAY
      await act(async () => {
        jest.advanceTimersByTime(SCROLL_DELAY - 1);
      });
      expect(mockScrollIntoView).not.toHaveBeenCalled();

      // Advance past SCROLL_DELAY
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(mockScrollIntoView).toHaveBeenCalled();

      // Clean up remaining timers
      jest.runAllTimers();
    });
  });

  describe('navigateToView without element', () => {
    it('should not scroll when element does not exist', async () => {
      const tabRefs = { current: new Map() };
      const { result } = renderHook(() =>
        useDatabaseViewNavigation(tabRefs as React.MutableRefObject<Map<string, HTMLElement>>)
      );

      const navigatePromise = result.current.navigateToView('nonexistent-view');

      await act(async () => {
        jest.runAllTimers();
      });

      await navigatePromise;

      // scrollIntoView should have been called twice (initial try + fallback try)
      // but since element doesn't exist, it won't actually be called
      expect(mockScrollIntoView).not.toHaveBeenCalled();
    });

    it('should trigger fallback scroll after SCROLL_FALLBACK_DELAY', async () => {
      const tabRefs = { current: new Map() };
      const { result } = renderHook(() =>
        useDatabaseViewNavigation(tabRefs as React.MutableRefObject<Map<string, HTMLElement>>)
      );

      result.current.navigateToView('view-123');

      // Fast-forward initial delay
      await act(async () => {
        jest.advanceTimersByTime(SCROLL_DELAY);
      });

      // Element is not found, so fallback timer should be set
      expect(mockScrollIntoView).not.toHaveBeenCalled();

      // Add element before fallback fires
      const mockElement = document.createElement('div');
      mockElement.scrollIntoView = mockScrollIntoView;
      tabRefs.current.set('view-123', mockElement);

      // Fast-forward to fallback delay
      await act(async () => {
        jest.advanceTimersByTime(SCROLL_FALLBACK_DELAY);
      });

      // Now scrollIntoView should have been called by fallback
      expect(mockScrollIntoView).toHaveBeenCalled();
    });
  });

  describe('ref map updates', () => {
    it('should handle ref map updates between calls', async () => {
      const mockElement1 = document.createElement('div');
      const mockElement2 = document.createElement('div');
      mockElement1.scrollIntoView = mockScrollIntoView;
      mockElement2.scrollIntoView = mockScrollIntoView;

      const tabRefs = { current: new Map([['view-1', mockElement1]]) };
      const { result } = renderHook(() =>
        useDatabaseViewNavigation(tabRefs as React.MutableRefObject<Map<string, HTMLElement>>)
      );

      // First navigation
      const nav1Promise = result.current.navigateToView('view-1');
      await act(async () => {
        jest.runAllTimers();
      });
      await nav1Promise;

      expect(mockScrollIntoView).toHaveBeenCalledTimes(1);
      mockScrollIntoView.mockClear();

      // Update ref map
      tabRefs.current = new Map([['view-2', mockElement2]]);

      // Second navigation
      const nav2Promise = result.current.navigateToView('view-2');
      await act(async () => {
        jest.runAllTimers();
      });
      await nav2Promise;

      expect(mockScrollIntoView).toHaveBeenCalledTimes(1);
    });
  });
});
