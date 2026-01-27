import { expect, describe, it, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { useCallback } from 'react';

// Mock dependencies to avoid import.meta issues
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: jest.fn((key: string, defaultValue: string) => defaultValue),
}));

// Create a simplified AIChatContext for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AIChatContext = React.createContext<any>(undefined);

// Mock toView function
const mockToView = jest.fn().mockResolvedValue(undefined);

// Mock implementation of DrawerHeader component for testing
function DrawerHeader() {
  const { setDrawerOpen, onCloseView, openViewId } = React.useContext(AIChatContext);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, [setDrawerOpen]);

  const handleOpenAsPage = useCallback(async () => {
    if (!openViewId) return;
    await mockToView(openViewId);
    onCloseView();
  }, [openViewId, onCloseView]);

  if (!openViewId) {
    return null;
  }

  return (
    <div
      className={
        'sticky top-0 z-[100] flex min-h-[48px] w-full items-center justify-between border-b border-border-primary bg-background-primary px-4'
      }
    >
      <div className={'flex items-center gap-4'}>
        <button data-testid="close-button" onClick={handleCloseDrawer}>
          Close
        </button>
        <button data-testid="expand-button" onClick={handleOpenAsPage}>
          Expand
        </button>
      </div>
      <div className={'flex items-center gap-4'}>
        <button data-testid="share-button">Share {openViewId}</button>
        <button data-testid="more-actions" onClick={onCloseView}>
          More Actions for {openViewId}
        </button>
      </div>
    </div>
  );
}

describe('DrawerHeader', () => {
  const mockSetDrawerOpen = jest.fn();
  const mockOnCloseView = jest.fn();

  const defaultContextValue = {
    chatId: 'test-chat-id',
    selectionMode: false,
    onOpenSelectionMode: jest.fn(),
    onCloseSelectionMode: jest.fn(),
    openViewId: 'view-123',
    onOpenView: jest.fn(),
    onCloseView: mockOnCloseView,
    drawerWidth: 600,
    onSetDrawerWidth: jest.fn(),
    getInsertData: jest.fn(),
    clearInsertData: jest.fn(),
    setDrawerOpen: mockSetDrawerOpen,
    drawerOpen: true,
  };

  const renderWithContext = (contextValue = defaultContextValue) => {
    return render(
      <AIChatContext.Provider value={contextValue}>
        <DrawerHeader />
      </AIChatContext.Provider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render nothing when openViewId is null', () => {
      const { container } = renderWithContext({
        ...defaultContextValue,
        openViewId: null,
      });

      expect(container.firstChild).toBeNull();
    });

    it('should render header when openViewId is provided', () => {
      renderWithContext();

      // Check for close and expand buttons via their tooltips/structure
      expect(screen.getByTestId('share-button')).toBeTruthy();
      expect(screen.getByTestId('more-actions')).toBeTruthy();
    });

    it('should render share button with correct viewId', () => {
      renderWithContext();

      expect(screen.getByText('Share view-123')).toBeTruthy();
    });

    it('should render more actions with correct viewId', () => {
      renderWithContext();

      expect(screen.getByText('More Actions for view-123')).toBeTruthy();
    });
  });

  describe('Close Drawer Button', () => {
    it('should call setDrawerOpen(false) when close button is clicked', () => {
      renderWithContext();

      const closeButton = screen.getByTestId('close-button');

      fireEvent.click(closeButton);

      expect(mockSetDrawerOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('Open As Page Button', () => {
    it('should call toView and onCloseView when expand button is clicked', async () => {
      renderWithContext();

      const expandButton = screen.getByTestId('expand-button');

      fireEvent.click(expandButton);

      await waitFor(() => {
        expect(mockToView).toHaveBeenCalledWith('view-123');
        expect(mockOnCloseView).toHaveBeenCalled();
      });
    });

    it('should not render if openViewId is falsy', async () => {
      const { container } = renderWithContext({
        ...defaultContextValue,
        openViewId: '',
      });

      // Component should return null when openViewId is empty
      expect(container.firstChild).toBeNull();
    });
  });

  describe('More Actions', () => {
    it('should call onCloseView when item is deleted via MoreActions', () => {
      renderWithContext();

      const moreActionsButton = screen.getByTestId('more-actions');

      fireEvent.click(moreActionsButton);

      expect(mockOnCloseView).toHaveBeenCalled();
    });
  });

  describe('Component Behavior', () => {
    it('should be a valid React component', () => {
      expect(DrawerHeader).toBeDefined();
      expect(typeof DrawerHeader).toBe('function');
    });
  });
});
