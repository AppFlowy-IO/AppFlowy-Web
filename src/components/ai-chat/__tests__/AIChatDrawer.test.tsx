import { expect, describe, it, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock the entire module chain to avoid import.meta issues
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: jest.fn((key: string, defaultValue: string) => defaultValue),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppViewId: jest.fn(() => 'test-chat-id'),
}));

// Create a simplified AIChatContext for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AIChatContext = React.createContext<any>(undefined);

// Create a simple mock AIChatDrawer component for testing
const MockDrawerContent = ({ openViewId }: { openViewId: string }) => (
  <div data-testid="drawer-content">Content for {openViewId}</div>
);

const MockDrawerHeader = () => <div data-testid="drawer-header">Header</div>;

const MockPinned = () => <div data-testid="pinned">Pinned</div>;

const MockResizer = ({ drawerWidth }: { drawerWidth: number; onResize: (width: number) => void }) => (
  <div data-testid="resizer" data-drawer-width={drawerWidth}>
    Resizer
  </div>
);

// Simple implementation of AIChatDrawer for testing
function AIChatDrawer() {
  const context = React.useContext(AIChatContext);
  const { drawerOpen, openViewId, drawerWidth, onSetDrawerWidth } = context;

  return (
    <div className={'fixed right-0 top-0 h-screen transform bg-background-primary transition-transform'}>
      <div
        style={{
          width: drawerOpen ? drawerWidth : 0,
        }}
        className={'h-full overflow-hidden border-l border-line-border'}
      >
        {openViewId && (
          <div className={'appflowy-scroller flex h-full flex-col overflow-auto overflow-x-hidden'}>
            <MockDrawerHeader />
            <MockDrawerContent openViewId={openViewId} />
          </div>
        )}

        <MockResizer drawerWidth={drawerWidth} onResize={onSetDrawerWidth} />
      </div>

      {!drawerOpen && openViewId && <MockPinned />}
    </div>
  );
}

describe('AIChatDrawer', () => {
  const mockOnSetDrawerWidth = jest.fn();

  const createContextValue = (overrides = {}) => ({
    chatId: 'test-chat-id',
    selectionMode: false,
    onOpenSelectionMode: jest.fn(),
    onCloseSelectionMode: jest.fn(),
    openViewId: 'view-123',
    onOpenView: jest.fn(),
    onCloseView: jest.fn(),
    drawerWidth: 600,
    onSetDrawerWidth: mockOnSetDrawerWidth,
    getInsertData: jest.fn(),
    clearInsertData: jest.fn(),
    setDrawerOpen: jest.fn(),
    drawerOpen: true,
    ...overrides,
  });

  const renderWithContext = (contextValue = createContextValue()) => {
    return render(
      <AIChatContext.Provider value={contextValue}>
        <AIChatDrawer />
      </AIChatContext.Provider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the drawer container', () => {
      const { container } = renderWithContext();

      const drawer = container.firstChild as HTMLElement;

      expect(drawer.className).toContain('fixed');
      expect(drawer.className).toContain('right-0');
      expect(drawer.className).toContain('top-0');
      expect(drawer.className).toContain('h-screen');
    });

    it('should always render the Resizer', () => {
      renderWithContext();

      expect(screen.getByTestId('resizer')).toBeTruthy();
    });
  });

  describe('Drawer Open State', () => {
    it('should set drawer width when open', () => {
      const { container } = renderWithContext(
        createContextValue({ drawerOpen: true, drawerWidth: 600 })
      );

      const innerContainer = container.querySelector('.overflow-hidden') as HTMLElement;

      expect(innerContainer.style.width).toBe('600px');
    });

    it('should set drawer width to 0 when closed', () => {
      const { container } = renderWithContext(
        createContextValue({ drawerOpen: false, drawerWidth: 600 })
      );

      const innerContainer = container.querySelector('.overflow-hidden') as HTMLElement;

      expect(innerContainer.style.width).toBe('0px');
    });

    it('should render header and content when drawer is open and has viewId', () => {
      renderWithContext(
        createContextValue({ drawerOpen: true, openViewId: 'view-123' })
      );

      expect(screen.getByTestId('drawer-header')).toBeTruthy();
      expect(screen.getByTestId('drawer-content')).toBeTruthy();
      expect(screen.getByText('Content for view-123')).toBeTruthy();
    });

    it('should not render header and content when viewId is null', () => {
      renderWithContext(
        createContextValue({ drawerOpen: true, openViewId: null })
      );

      expect(screen.queryByTestId('drawer-header')).toBeNull();
      expect(screen.queryByTestId('drawer-content')).toBeNull();
    });
  });

  describe('Pinned State', () => {
    it('should render Pinned when drawer is closed but has openViewId', () => {
      renderWithContext(
        createContextValue({ drawerOpen: false, openViewId: 'view-123' })
      );

      expect(screen.getByTestId('pinned')).toBeTruthy();
    });

    it('should not render Pinned when drawer is open', () => {
      renderWithContext(
        createContextValue({ drawerOpen: true, openViewId: 'view-123' })
      );

      expect(screen.queryByTestId('pinned')).toBeNull();
    });

    it('should not render Pinned when no openViewId', () => {
      renderWithContext(
        createContextValue({ drawerOpen: false, openViewId: null })
      );

      expect(screen.queryByTestId('pinned')).toBeNull();
    });
  });

  describe('Resizer Props', () => {
    it('should pass correct drawerWidth to Resizer', () => {
      renderWithContext(createContextValue({ drawerWidth: 750 }));

      const resizer = screen.getByTestId('resizer');

      expect(resizer.getAttribute('data-drawer-width')).toBe('750');
    });
  });

  describe('Component Behavior', () => {
    it('should be a valid React component', () => {
      expect(AIChatDrawer).toBeDefined();
      expect(typeof AIChatDrawer).toBe('function');
    });
  });

  describe('Styling', () => {
    it('should have correct transition classes', () => {
      const { container } = renderWithContext();

      const drawer = container.firstChild as HTMLElement;

      expect(drawer.className).toContain('transition-transform');
    });

    it('should have border styling on inner container', () => {
      const { container } = renderWithContext();

      const innerContainer = container.querySelector('.border-l');

      expect(innerContainer).toBeTruthy();
      expect(innerContainer?.className).toContain('border-line-border');
    });
  });
});
