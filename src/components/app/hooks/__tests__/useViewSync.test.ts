import { renderHook, waitFor } from '@testing-library/react';
import { expect } from '@jest/globals';
import * as Y from 'yjs';
import { useDatabaseViewSync } from '../useViewSync';
import { SYNC_MAX_ATTEMPTS, SYNC_POLL_INTERVAL } from '../constants';

describe('useDatabaseViewSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('waitForViewData', () => {
    it('should return true immediately when view exists', async () => {
      const mockViewsMap = new Map();
      mockViewsMap.set('view-123', { name: 'Test View' });

      const mockViews = {
        has: jest.fn((viewId: string) => mockViewsMap.has(viewId)),
      } as unknown as Y.Map<any>;

      const { result } = renderHook(() => useDatabaseViewSync(mockViews));

      const promise = result.current.waitForViewData('view-123');

      // Fast-forward timers since the view exists immediately
      jest.runAllTimers();

      const exists = await promise;

      expect(exists).toBe(true);
      expect(mockViews.has).toHaveBeenCalledWith('view-123');
    });

    it('should poll and return true when view becomes available', async () => {
      const mockViewsMap = new Map();
      let callCount = 0;

      const mockViews = {
        has: jest.fn((viewId: string) => {
          callCount++;
          // View becomes available on the 3rd call
          if (callCount >= 3) {
            mockViewsMap.set(viewId, { name: 'Test View' });
          }
          return mockViewsMap.has(viewId);
        }),
      } as unknown as Y.Map<any>;

      const { result } = renderHook(() => useDatabaseViewSync(mockViews));

      const promise = result.current.waitForViewData('view-123');

      // Fast-forward through polling intervals
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(SYNC_POLL_INTERVAL);
        await Promise.resolve(); // Allow promises to resolve
      }

      const exists = await promise;

      expect(exists).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it('should return false after max attempts when view never appears', async () => {
      const mockViews = {
        has: jest.fn(() => false),
      } as unknown as Y.Map<any>;

      const { result } = renderHook(() => useDatabaseViewSync(mockViews));

      const promise = result.current.waitForViewData('nonexistent-view');

      // Fast-forward through all polling intervals
      for (let i = 0; i < SYNC_MAX_ATTEMPTS + 1; i++) {
        jest.advanceTimersByTime(SYNC_POLL_INTERVAL);
        await Promise.resolve();
      }

      const exists = await promise;

      expect(exists).toBe(false);
      expect(mockViews.has).toHaveBeenCalledTimes(SYNC_MAX_ATTEMPTS);
    });

    it('should handle undefined views map gracefully', async () => {
      const { result } = renderHook(() => useDatabaseViewSync(undefined));

      const promise = result.current.waitForViewData('view-123');

      // Fast-forward through all polling intervals
      for (let i = 0; i < SYNC_MAX_ATTEMPTS + 1; i++) {
        jest.advanceTimersByTime(SYNC_POLL_INTERVAL);
        await Promise.resolve();
      }

      const exists = await promise;

      expect(exists).toBe(false);
    });

    it('should update waitForViewData when views map changes', async () => {
      const mockViewsMap1 = new Map();
      const mockViews1 = {
        has: jest.fn((viewId: string) => mockViewsMap1.has(viewId)),
      } as unknown as Y.Map<any>;

      const { result, rerender } = renderHook(
        ({ views }) => useDatabaseViewSync(views),
        { initialProps: { views: mockViews1 } }
      );

      // First call with empty map
      let promise = result.current.waitForViewData('view-123');
      jest.advanceTimersByTime(SYNC_POLL_INTERVAL);
      await Promise.resolve();

      // Update to new map with the view
      const mockViewsMap2 = new Map([['view-123', { name: 'Test' }]]);
      const mockViews2 = {
        has: jest.fn((viewId: string) => mockViewsMap2.has(viewId)),
      } as unknown as Y.Map<any>;

      rerender({ views: mockViews2 });

      // New call should use updated map
      promise = result.current.waitForViewData('view-123');
      jest.runAllTimers();

      const exists = await promise;

      expect(exists).toBe(true);
      expect(mockViews2.has).toHaveBeenCalledWith('view-123');
    });
  });
});
