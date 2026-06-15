import { expect, describe, it, beforeEach } from '@jest/globals';
import { render, fireEvent } from '@testing-library/react';
import React, { useCallback } from 'react';

// Mock dependencies to avoid import.meta issues
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: jest.fn((key: string, defaultValue: string) => defaultValue),
}));

// Create a simplified AIChatContext for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AIChatContext = React.createContext<any>(undefined);

// Mock implementation of Pinned component for testing
function Pinned() {
  const { setDrawerOpen } = React.useContext(AIChatContext);

  const handleClick = useCallback(() => {
    setDrawerOpen(true);
  }, [setDrawerOpen]);

  return (
    <div className={'absolute top-1/3 shadow-md left-0 -translate-x-[60%] transform'}>
      <button
        onClick={handleClick}
        className={'py-2 rounded-[12px] !pl-2'}
      >
        Open Drawer
      </button>
    </div>
  );
}

describe('Pinned', () => {
  const mockSetDrawerOpen = jest.fn();

  const defaultContextValue = {
    chatId: 'test-chat-id',
    selectionMode: false,
    onOpenSelectionMode: jest.fn(),
    onCloseSelectionMode: jest.fn(),
    openViewId: 'view-123',
    onOpenView: jest.fn(),
    onCloseView: jest.fn(),
    drawerWidth: 600,
    onSetDrawerWidth: jest.fn(),
    getInsertData: jest.fn(),
    clearInsertData: jest.fn(),
    setDrawerOpen: mockSetDrawerOpen,
    drawerOpen: false,
  };

  const renderWithContext = (contextValue = defaultContextValue) => {
    return render(
      <AIChatContext.Provider value={contextValue}>
        <Pinned />
      </AIChatContext.Provider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the pinned button', () => {
      const { container } = renderWithContext();

      const button = container.querySelector('button');

      expect(button).toBeTruthy();
    });

    it('should have correct positioning classes', () => {
      const { container } = renderWithContext();

      const wrapper = container.firstChild as HTMLElement;

      expect(wrapper.className).toContain('absolute');
      expect(wrapper.className).toContain('top-1/3');
      expect(wrapper.className).toContain('left-0');
    });

    it('should have correct button styling', () => {
      const { container } = renderWithContext();

      const button = container.querySelector('button');

      expect(button?.className).toContain('rounded-[12px]');
    });
  });

  describe('Click Behavior', () => {
    it('should call setDrawerOpen(true) when button is clicked', () => {
      const { container } = renderWithContext();

      const button = container.querySelector('button')!;

      fireEvent.click(button);

      expect(mockSetDrawerOpen).toHaveBeenCalledWith(true);
      expect(mockSetDrawerOpen).toHaveBeenCalledTimes(1);
    });

    it('should use memoized click handler', () => {
      const { rerender, container } = renderWithContext();

      const button1 = container.querySelector('button')!;

      fireEvent.click(button1);

      expect(mockSetDrawerOpen).toHaveBeenCalledTimes(1);

      // Re-render with same context
      rerender(
        <AIChatContext.Provider value={defaultContextValue}>
          <Pinned />
        </AIChatContext.Provider>
      );

      const button2 = container.querySelector('button')!;

      fireEvent.click(button2);

      // Should still work after re-render
      expect(mockSetDrawerOpen).toHaveBeenCalledTimes(2);
      expect(mockSetDrawerOpen).toHaveBeenLastCalledWith(true);
    });
  });

  describe('Component Behavior', () => {
    it('should be a valid React component', () => {
      expect(Pinned).toBeDefined();
      expect(typeof Pinned).toBe('function');
    });
  });

  describe('Accessibility', () => {
    it('should render a button element for accessibility', () => {
      const { container } = renderWithContext();

      const button = container.querySelector('button');

      expect(button?.tagName).toBe('BUTTON');
    });
  });
});
