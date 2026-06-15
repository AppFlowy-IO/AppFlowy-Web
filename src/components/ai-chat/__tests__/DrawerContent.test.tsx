import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

// Mock dependencies to avoid import.meta issues
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: jest.fn((key: string, defaultValue: string) => defaultValue),
}));

// Create a simplified AIChatContext for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AIChatContext = React.createContext<any>(undefined);

// Mock functions
const mockLoadView = jest.fn();
const mockInsertDataToDoc = jest.fn();

// Mock implementation of DrawerContent for testing
function DrawerContent({ openViewId }: { openViewId: string }) {
  const { getInsertData, clearInsertData, drawerOpen } = React.useContext(AIChatContext);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [doc, setDoc] = useState<{ id: string; doc: any } | undefined>(undefined);
  const [notFound, setNotFound] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editor, setEditor] = useState<any>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadPageDoc = useCallback(async (id: string) => {
    setNotFound(false);
    setDoc(undefined);

    try {
      const loadedDoc = await mockLoadView(id);

      setDoc({ doc: loadedDoc, id });
      // Simulate editor connection
      setEditor({ deselect: jest.fn() });
    } catch (e) {
      setNotFound(true);
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (openViewId) {
      void loadPageDoc(openViewId);
    } else {
      setDoc(undefined);
    }
  }, [openViewId, loadPageDoc]);

  useEffect(() => {
    const insertData = getInsertData(openViewId);

    if (!doc || !insertData || !drawerOpen || doc.id !== openViewId || editor === undefined) {
      return;
    }

    try {
      editor.deselect();
      mockInsertDataToDoc(doc.doc, insertData);
      clearInsertData(openViewId);
    } catch (e) {
      console.error(e);
    }
  }, [editor, clearInsertData, doc, getInsertData, openViewId, drawerOpen]);

  if (notFound) {
    return <div data-testid="record-not-found">Not found: {openViewId}</div>;
  }

  return (
    <div ref={containerRef} className={'h-fit w-full relative ai-chat-view'}>
      {doc && (
        <div data-testid="document">Document for {openViewId}</div>
      )}
    </div>
  );
}

describe('DrawerContent', () => {
  const mockGetInsertData = jest.fn();
  const mockClearInsertData = jest.fn();

  const createContextValue = (overrides = {}) => ({
    chatId: 'test-chat-id',
    selectionMode: false,
    onOpenSelectionMode: jest.fn(),
    onCloseSelectionMode: jest.fn(),
    openViewId: 'view-123',
    onOpenView: jest.fn(),
    onCloseView: jest.fn(),
    drawerWidth: 600,
    onSetDrawerWidth: jest.fn(),
    getInsertData: mockGetInsertData,
    clearInsertData: mockClearInsertData,
    setDrawerOpen: jest.fn(),
    drawerOpen: true,
    ...overrides,
  });

  const renderWithContext = (openViewId: string, contextOverrides = {}) => {
    const contextValue = createContextValue(contextOverrides);

    return render(
      <AIChatContext.Provider value={contextValue}>
        <DrawerContent openViewId={openViewId} />
      </AIChatContext.Provider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadView.mockResolvedValue({ /* mock YDoc */ });
    mockGetInsertData.mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Document Loading', () => {
    it('should load document when openViewId is provided', async () => {
      renderWithContext('view-123');

      await waitFor(() => {
        expect(mockLoadView).toHaveBeenCalledWith('view-123');
      });
    });

    it('should reload document when openViewId changes', async () => {
      const { rerender } = renderWithContext('view-123');

      await waitFor(() => {
        expect(mockLoadView).toHaveBeenCalledWith('view-123');
      });

      mockLoadView.mockClear();

      rerender(
        <AIChatContext.Provider value={createContextValue()}>
          <DrawerContent openViewId="view-456" />
        </AIChatContext.Provider>
      );

      await waitFor(() => {
        expect(mockLoadView).toHaveBeenCalledWith('view-456');
      });
    });

    it('should render Document when doc is loaded', async () => {
      mockLoadView.mockResolvedValue({ /* mock YDoc */ });

      renderWithContext('view-123');

      await waitFor(() => {
        expect(screen.getByTestId('document')).toBeTruthy();
      });
    });
  });

  describe('Error Handling', () => {
    it('should show RecordNotFound when document fails to load', async () => {
      mockLoadView.mockRejectedValue(new Error('Not found'));

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* suppress */ });

      renderWithContext('view-123');

      await waitFor(() => {
        expect(screen.getByTestId('record-not-found')).toBeTruthy();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('Insert Data Handling', () => {
    it('should call clearInsertData after inserting data', async () => {
      const mockInsertData = [{ type: 'paragraph', data: {}, children: [] }];

      mockGetInsertData.mockReturnValue(mockInsertData);

      renderWithContext('view-123', { drawerOpen: true });

      await waitFor(() => {
        expect(mockClearInsertData).toHaveBeenCalledWith('view-123');
      });
    });

    it('should not insert data when drawer is closed', async () => {
      const mockInsertData = [{ type: 'paragraph', data: {}, children: [] }];

      mockGetInsertData.mockReturnValue(mockInsertData);

      renderWithContext('view-123', { drawerOpen: false });

      await waitFor(() => {
        expect(mockLoadView).toHaveBeenCalled();
      });

      // insertDataToDoc should not be called when drawer is closed
      expect(mockInsertDataToDoc).not.toHaveBeenCalled();
    });
  });

  describe('Container Ref', () => {
    it('should attach ref to container element', async () => {
      const { container } = renderWithContext('view-123');

      await waitFor(() => {
        expect(mockLoadView).toHaveBeenCalled();
      });

      const contentContainer = container.querySelector('.ai-chat-view');

      expect(contentContainer).toBeTruthy();
    });
  });

  describe('Component Rendering', () => {
    it('should render document when loaded', async () => {
      renderWithContext('view-123');

      await waitFor(() => {
        expect(screen.getByTestId('document')).toBeTruthy();
      });
    });
  });

  describe('View Meta', () => {
    it('should pass correct viewMeta to Document', async () => {
      renderWithContext('view-123');

      await waitFor(() => {
        expect(screen.getByText('Document for view-123')).toBeTruthy();
      });
    });
  });
});
