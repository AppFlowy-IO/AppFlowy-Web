import { expect, describe, it, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

import { AIChatProvider, useAIChatContext, useAIChatContextOptional } from '../AIChatProvider';

// Mock dependencies
jest.mock('@/components/app/app.hooks', () => ({
  useAppViewId: jest.fn(() => 'test-chat-id'),
}));

jest.mock('../AIChatDrawer', () => ({
  __esModule: true,
  default: () => null,
}));

describe('AIChatProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('useAIChatContext', () => {
    it('should throw error when used outside provider', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => { /* suppress error */ });

      expect(() => {
        renderHook(() => useAIChatContext());
      }).toThrow('useAIChatContext must be used within a AIChatProvider');

      consoleError.mockRestore();
    });

    it('should return context when used within provider', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      expect(result.current).toBeDefined();
      expect(result.current.chatId).toBe('test-chat-id');
    });
  });

  describe('useAIChatContextOptional', () => {
    it('should return undefined when used outside provider', () => {
      const { result } = renderHook(() => useAIChatContextOptional());

      expect(result.current).toBeUndefined();
    });

    it('should return context when used within provider', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContextOptional(), { wrapper });

      expect(result.current).toBeDefined();
    });
  });

  describe('Initial State', () => {
    it('should have correct initial values', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      expect(result.current.chatId).toBe('test-chat-id');
      expect(result.current.selectionMode).toBe(false);
      expect(result.current.openViewId).toBeNull();
      expect(result.current.drawerOpen).toBe(false);
      expect(result.current.drawerWidth).toBe(600);
    });
  });

  describe('Selection Mode', () => {
    it('should enable selection mode', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      expect(result.current.selectionMode).toBe(false);

      act(() => {
        result.current.onOpenSelectionMode();
      });

      expect(result.current.selectionMode).toBe(true);
    });

    it('should disable selection mode', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      act(() => {
        result.current.onOpenSelectionMode();
      });

      expect(result.current.selectionMode).toBe(true);

      act(() => {
        result.current.onCloseSelectionMode();
      });

      expect(result.current.selectionMode).toBe(false);
    });
  });

  describe('View Management', () => {
    it('should open view and set drawer open', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      act(() => {
        result.current.onOpenView('view-123');
      });

      expect(result.current.openViewId).toBe('view-123');
      expect(result.current.drawerOpen).toBe(true);
    });

    it('should close view and reset state', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      act(() => {
        result.current.onOpenView('view-123');
      });

      expect(result.current.openViewId).toBe('view-123');

      act(() => {
        result.current.onCloseView();
      });

      expect(result.current.openViewId).toBeNull();
      expect(result.current.drawerOpen).toBe(false);
    });

    it('should store and retrieve insert data', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      const mockInsertData = [{ type: 'paragraph', data: {}, children: [] }];

      act(() => {
        result.current.onOpenView('view-123', mockInsertData);
      });

      const retrievedData = result.current.getInsertData('view-123');

      expect(retrievedData).toEqual(mockInsertData);
    });

    it('should clear insert data correctly (regression test for state mutation bug)', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      const mockInsertData = [{ type: 'paragraph', data: {}, children: [] }];

      act(() => {
        result.current.onOpenView('view-123', mockInsertData);
      });

      expect(result.current.getInsertData('view-123')).toEqual(mockInsertData);

      act(() => {
        result.current.clearInsertData('view-123');
      });

      // This test verifies the bug fix - previously the Map was mutated directly
      // which wouldn't trigger a re-render
      expect(result.current.getInsertData('view-123')).toBeUndefined();
    });
  });

  describe('Drawer Width', () => {
    it('should update drawer width', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      expect(result.current.drawerWidth).toBe(600);

      act(() => {
        result.current.onSetDrawerWidth(800);
      });

      expect(result.current.drawerWidth).toBe(800);
    });
  });

  describe('Drawer Open State', () => {
    it('should manually set drawer open state', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result } = renderHook(() => useAIChatContext(), { wrapper });

      expect(result.current.drawerOpen).toBe(false);

      act(() => {
        result.current.onOpenView('view-123');
      });

      expect(result.current.drawerOpen).toBe(true);

      act(() => {
        result.current.setDrawerOpen(false);
      });

      expect(result.current.drawerOpen).toBe(false);
    });
  });

  describe('Context Value Memoization', () => {
    it('should provide stable callback references', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AIChatProvider>{children}</AIChatProvider>
      );

      const { result, rerender } = renderHook(() => useAIChatContext(), { wrapper });

      const firstCallbacks = {
        onOpenSelectionMode: result.current.onOpenSelectionMode,
        onCloseSelectionMode: result.current.onCloseSelectionMode,
        onOpenView: result.current.onOpenView,
        onCloseView: result.current.onCloseView,
        onSetDrawerWidth: result.current.onSetDrawerWidth,
      };

      rerender();

      // Callbacks should be stable (same reference) due to useCallback
      expect(result.current.onOpenSelectionMode).toBe(firstCallbacks.onOpenSelectionMode);
      expect(result.current.onCloseSelectionMode).toBe(firstCallbacks.onCloseSelectionMode);
      expect(result.current.onOpenView).toBe(firstCallbacks.onOpenView);
      expect(result.current.onCloseView).toBe(firstCallbacks.onCloseView);
      expect(result.current.onSetDrawerWidth).toBe(firstCallbacks.onSetDrawerWidth);
    });
  });
});
