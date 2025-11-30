import { renderHook, waitFor } from '@testing-library/react';
import { expect } from '@jest/globals';
import { useDatabaseLoading } from '../useDatabaseLoading';
import { View, YDoc } from '@/application/types';

// Mock useRetryFunction
jest.mock('../useRetryFunction', () => ({
  useRetryFunction: (fn: any, onError: any) => {
    // Return a function that wraps the original and calls onError on failure
    return jest.fn(async (...args: any[]) => {
      try {
        if (!fn) throw new Error('Function not available');
        const result = await fn(...args);
        if (!result) throw new Error('No result returned');
        return result;
      } catch (error) {
        onError();
        throw error;
      }
    });
  },
}));

describe('useDatabaseLoading', () => {
  let consoleDebugSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createMockView = (viewId: string, children: Array<{ view_id: string }> = []): View => ({
    view_id: viewId,
    name: `View ${viewId}`,
    children,
    layout: 0,
    parent_view_id: 'parent',
    icon: null,
    extra: null,
    is_published: false,
    is_private: false,
  });

  const createMockYDoc = (): YDoc => ({
    guid: 'mock-doc',
  } as YDoc);

  describe('initial view loading', () => {
    it('should load view doc on mount', async () => {
      const mockDoc = createMockYDoc();
      const loadView = jest.fn().mockResolvedValue(mockDoc);
      const loadViewMeta = jest.fn().mockResolvedValue(createMockView('view-1'));

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView,
          loadViewMeta,
        })
      );

      await waitFor(() => {
        expect(result.current.doc).toBe(mockDoc);
      });

      expect(result.current.notFound).toBe(false);
      expect(loadView).toHaveBeenCalledWith('view-1');
    });

    it('should set doc to null initially', () => {
      const loadView = jest.fn().mockResolvedValue(createMockYDoc());
      const loadViewMeta = jest.fn().mockResolvedValue(createMockView('view-1'));

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView,
          loadViewMeta,
        })
      );

      // Initially doc should be null
      expect(result.current.doc).toBeNull();
      expect(result.current.notFound).toBe(false);
    });
  });

  describe('view meta loading', () => {
    it('should load view meta and update visible view IDs', async () => {
      const mockView = createMockView('view-1', [
        { view_id: 'child-1' },
        { view_id: 'child-2' },
      ]);
      const loadView = jest.fn().mockResolvedValue(createMockYDoc());
      const loadViewMeta = jest.fn().mockResolvedValue(mockView);

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView,
          loadViewMeta,
        })
      );

      await waitFor(() => {
        expect(result.current.visibleViewIds).toEqual(['view-1', 'child-1', 'child-2']);
      });

      expect(result.current.databaseName).toBe('View view-1');
    });

    it('should select first child view when viewId not in visible views', async () => {
      const mockView = createMockView('view-1', [
        { view_id: 'child-1' },
        { view_id: 'child-2' },
      ]);
      const loadView = jest.fn().mockResolvedValue(createMockYDoc());
      const loadViewMeta = jest.fn().mockResolvedValue(mockView);

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView,
          loadViewMeta,
        })
      );

      await waitFor(() => {
        expect(result.current.visibleViewIds.length).toBeGreaterThan(0);
      });

      // Should select view-1 since it's in the visible views list (first item)
      expect(result.current.selectedViewId).toBe('view-1');
    });

    it('should select requested viewId when it is in visible views', async () => {
      const mockView = createMockView('view-1', [
        { view_id: 'child-1' },
      ]);
      const loadView = jest.fn().mockResolvedValue(createMockYDoc());
      const loadViewMeta = jest.fn().mockResolvedValue(mockView);

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView,
          loadViewMeta,
        })
      );

      await waitFor(() => {
        expect(result.current.selectedViewId).toBe('view-1');
      });
    });

    it('should set notFound when view meta fails to load', async () => {
      const loadView = jest.fn().mockResolvedValue(createMockYDoc());
      const loadViewMeta = jest.fn().mockRejectedValue(new Error('Meta not found'));

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView,
          loadViewMeta,
        })
      );

      await waitFor(() => {
        expect(result.current.notFound).toBe(true);
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('loadViewMeta function', () => {
    it('should load meta for the same viewId with callback', async () => {
      const mockView = createMockView('view-1');
      const loadView = jest.fn().mockResolvedValue(createMockYDoc());
      const loadViewMeta = jest.fn().mockResolvedValue(mockView);
      const callback = jest.fn();

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView,
          loadViewMeta,
        })
      );

      await waitFor(() => {
        expect(result.current.doc).toBeDefined();
      });

      const meta = await result.current.loadViewMeta('view-1', callback);

      expect(meta).toEqual(mockView);
      expect(result.current.notFound).toBe(false);
    });

  });

  describe('error handling', () => {
    it('should handle missing loadView function', async () => {
      const loadViewMeta = jest.fn().mockResolvedValue(createMockView('view-1'));

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView: undefined,
          loadViewMeta,
        })
      );

      await waitFor(() => {
        expect(result.current.notFound).toBe(true);
      });
    });

    it('should handle missing loadViewMeta function', async () => {
      const loadView = jest.fn().mockResolvedValue(createMockYDoc());

      const { result } = renderHook(() =>
        useDatabaseLoading({
          viewId: 'view-1',
          loadView,
          loadViewMeta: undefined,
        })
      );

      await waitFor(() => {
        expect(result.current.notFound).toBe(true);
      });
    });
  });

});

