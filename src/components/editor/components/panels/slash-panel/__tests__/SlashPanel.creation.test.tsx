import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode, StrictMode } from 'react';
import { createEditor, Editor } from 'slate';

import { ViewLayout } from '@/application/types';
import { DatabaseViewCreationAction } from '@/components/app/hooks/useDatabaseViewCreation';

import { SlashPanel } from '../SlashPanel';

let mockAction: DatabaseViewCreationAction;
let mockSearch = '';
const mockRemoveContent = jest.fn();
const mockClosePanel = jest.fn();
const mockAddPage = jest.fn();
const mockCreateDatabaseView = jest.fn();
const mockCheckout = jest.fn();
const mockLoadCatalog = jest.fn();
const mockCheckCreation = jest.fn();
const mockCreationOptions = jest.fn();
const mockTranslate = (key: string) => key;
const mockIsPanelOpen = () => true;
const mockEditorDom = document.createElement('div');
const mockEditor = Object.assign(createEditor(), { flushLocalChanges: jest.fn() });
const mockFocus = jest.fn();
const mockBlur = jest.fn();
const mockEditorContext = {
  workspaceId: 'workspace',
  viewId: 'document',
  addPage: mockAddPage,
  createDatabaseView: mockCreateDatabaseView,
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('slate-react', () => ({
  ...jest.requireActual('slate-react'),
  useSlateStatic: () => mockEditor,
  ReactEditor: {
    toDOMNode: () => mockEditorDom,
    toDOMRange: () => ({ getBoundingClientRect: () => ({ bottom: 20, left: 10 }) }),
    focus: () => mockFocus(),
    blur: () => mockBlur(),
  },
}));
jest.mock('@/components/app/app.hooks', () => ({ useAIEnabled: () => false }));
jest.mock('@/components/chat', () => ({ useAIWriter: () => ({}) }));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  calculateOptimalOrigins: () => ({ transformOrigin: { vertical: 'top', horizontal: 'left' } }),
}));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => mockEditorContext }));
jest.mock('@/components/editor/components/block-popover/BlockPopoverContext', () => ({ usePopoverContext: () => ({}) }));
jest.mock('@/components/editor/components/panels/Panels.hooks', () => ({
  usePanelContext: () => ({
    isPanelOpen: mockIsPanelOpen,
    searchText: mockSearch,
    removeContent: mockRemoveContent,
    closePanel: mockClosePanel,
  }),
}));
jest.mock('@/application/slate-yjs/utils/editor', () => ({ getBlockEntry: () => undefined }));
jest.mock('@/components/editor/components/toolbar/selection-toolbar/utils', () => ({
  getRangeRect: () => ({ top: 0, left: 0 }),
}));
jest.mock('@/application/services/domains/view', () => ({
  getWorkspaceDatabaseCatalog: () => mockLoadCatalog(),
  getDatabaseContainerEntries: () => [{ databaseId: 'database', container: {}, primaryView: { view_id: 'source' } }],
  databaseCatalogViewToView: () => ({
    view_id: 'source',
    name: 'Source database',
    layout: ViewLayout.Grid,
    children: [],
  }),
}));
jest.mock('@/components/app/hooks/useDatabaseViewCreation', () => ({
  useDatabaseViewCreation: (options: unknown) => {
    mockCreationOptions(options);
    const action = mockAction;

    return {
      getAction: (layout?: ViewLayout) => (layout === undefined ? { type: 'create' } : action),
      checkCreation: (layout?: ViewLayout, close?: () => void) => {
        mockCheckCreation(layout);
        if (layout === undefined || action.type === 'create') return true;
        if (action.type === 'upgrade') {
          close?.();
          mockCheckout();
        }

        return false;
      },
    };
  },
}));

describe('slash database view admission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch = '';
    mockEditor.selection = null;
    mockAction = { type: 'upgrade', requiresPro: true, reason: 'Requires Pro' };
    mockAddPage.mockResolvedValue({ view_id: 'created', database_id: 'database' });
    mockLoadCatalog.mockResolvedValue([]);
  });

  it('does not request creation status for a search containing only ordinary blocks', () => {
    mockSearch = 'heading';
    render(<SlashPanel setEmojiPosition={jest.fn()} />);
    expect(mockCreationOptions).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('keeps checking for the rest of the slash session after a limited option was shown', () => {
    mockSearch = 'chart';
    const { rerender } = render(<SlashPanel setEmojiPosition={jest.fn()} />);

    expect(mockCreationOptions).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    mockSearch = 'heading';
    rerender(<SlashPanel setEmojiPosition={jest.fn()} />);
    expect(mockCreationOptions).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('uses the latest admission decision on Enter without reattaching the keyboard listener', () => {
    mockSearch = 'chart';
    mockAction = { type: 'create' };
    const setEmojiPosition = jest.fn();
    const listener = jest.spyOn(mockEditorDom, 'addEventListener');
    const { rerender } = render(<SlashPanel setEmojiPosition={setEmojiPosition} />);
    const initialListeners = listener.mock.calls.filter(([event]) => event === 'keydown').length;

    mockAction = { type: 'upgrade', requiresPro: true };
    rerender(<SlashPanel setEmojiPosition={setEmojiPosition} />);
    expect(listener.mock.calls.filter(([event]) => event === 'keydown')).toHaveLength(initialListeners);
    fireEvent.keyDown(mockEditorDom, { key: 'Enter' });
    expect(mockCheckout).toHaveBeenCalledTimes(1);
    expect(mockRemoveContent).not.toHaveBeenCalled();
    expect(mockAddPage).not.toHaveBeenCalled();
    listener.mockRestore();
  });

  it.each(['timeline', 'linkedTimeline', 'chart', 'linkedChart'])(
    '%s shows a crown and opens checkout without touching the editor',
    (key) => {
      mockSearch = key;
      render(<SlashPanel setEmojiPosition={jest.fn()} />);
      const item = screen.getByTestId(`slash-menu-${key}`);

      expect(within(item).getByLabelText('Pro')).toBeTruthy();
      fireEvent.click(item);
      expect(mockCheckout).toHaveBeenCalledTimes(1);
      expect(mockClosePanel).toHaveBeenCalledTimes(1);
      expect(mockCheckCreation).toHaveBeenCalledWith(
        key.toLowerCase().includes('chart') ? ViewLayout.Chart : ViewLayout.Timeline
      );
      expect(mockRemoveContent).not.toHaveBeenCalled();
      expect(mockEditor.flushLocalChanges).not.toHaveBeenCalled();
      expect(mockAddPage).not.toHaveBeenCalled();
      expect(mockLoadCatalog).not.toHaveBeenCalled();
      expect(mockCreateDatabaseView).not.toHaveBeenCalled();
    }
  );

  it.each(['disabled', 'upgrade'] as const)(
    'keyboard Enter follows the same %s check without deleting slash text',
    (type) => {
      mockSearch = 'chart';
      mockAction = { type, requiresPro: type === 'upgrade', reason: 'Unavailable' };
      render(<SlashPanel setEmojiPosition={jest.fn()} />);
      fireEvent.keyDown(mockEditorDom, { key: 'Enter' });
      expect(mockCheckCreation).toHaveBeenCalledWith(ViewLayout.Chart);
      expect(mockCheckout).toHaveBeenCalledTimes(type === 'upgrade' ? 1 : 0);
      expect(mockRemoveContent).not.toHaveBeenCalled();
      expect(mockEditor.flushLocalChanges).not.toHaveBeenCalled();
      expect(mockAddPage).not.toHaveBeenCalled();
    }
  );

  it('creates an allowed Chart once after removing the slash command', async () => {
    mockSearch = 'chart';
    mockAction = { type: 'create' };
    render(<SlashPanel setEmojiPosition={jest.fn()} />);
    const item = screen.getByTestId('slash-menu-chart');

    expect(within(item).queryByLabelText('Pro')).toBeNull();
    fireEvent.click(item);
    await waitFor(() =>
      expect(mockAddPage).toHaveBeenCalledWith('document', {
        layout: ViewLayout.Chart,
        name: 'document.plugins.database.newDatabase',
      })
    );
    expect(mockRemoveContent).toHaveBeenCalledTimes(1);
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it('rechecks linked Chart eligibility when a source is selected', async () => {
    mockSearch = 'linkedChart';
    mockAction = { type: 'create' };
    const { rerender } = render(<SlashPanel setEmojiPosition={jest.fn()} />);

    fireEvent.click(screen.getByTestId('slash-menu-linkedChart'));
    await screen.findByText('Source database');
    expect(mockRemoveContent).toHaveBeenCalledTimes(1);
    mockAction = { type: 'upgrade', requiresPro: true, reason: 'Requires Pro' };
    rerender(<SlashPanel setEmojiPosition={jest.fn()} />);
    fireEvent.click(screen.getByText('Source database'));
    expect(mockCheckout).toHaveBeenCalledTimes(1);
    expect(mockCreateDatabaseView).not.toHaveBeenCalled();
    expect(mockRemoveContent).toHaveBeenCalledTimes(1);
  });
});

describe('inline equation slash lifecycle in Strict Mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch = 'inline';
    mockAction = { type: 'create' };
    mockEditor.children = [{ type: 'paragraph', children: [{ text: 'Before' }] }];
    mockEditor.select({ path: [0, 0], offset: 6 });
  });

  it('cancels without changing text and restores the tracked selection once', () => {
    const originalSelection = mockEditor.selection;

    render(<StrictMode><SlashPanel setEmojiPosition={jest.fn()} /></StrictMode>);
    fireEvent.click(screen.getByTestId('slash-menu-inlineMath'));
    expect(Editor.rangeRefs(mockEditor).size).toBe(1);
    expect(mockBlur).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'document.plugins.mathEquation.inline' }), { target: { value: 'x^2' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'document.plugins.mathEquation.inline' }), { key: 'Escape' });
    expect(screen.queryByTestId('inline-equation-editor')).toBeNull();
    expect(Editor.rangeRefs(mockEditor).size).toBe(0);
    expect(mockEditor.selection).toEqual(originalSelection);
    expect(mockEditor.string([0])).toBe('Before');
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });

  it('releases the tracked selection if the slash panel unmounts while editing', () => {
    const { unmount } = render(<StrictMode><SlashPanel setEmojiPosition={jest.fn()} /></StrictMode>);

    fireEvent.click(screen.getByTestId('slash-menu-inlineMath'));
    expect(Editor.rangeRefs(mockEditor).size).toBe(1);
    unmount();
    expect(Editor.rangeRefs(mockEditor).size).toBe(0);
    expect(mockFocus).not.toHaveBeenCalled();
  });
});
