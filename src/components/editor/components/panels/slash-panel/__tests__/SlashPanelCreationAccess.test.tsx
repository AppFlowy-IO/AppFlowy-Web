import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createEditor, Descendant } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { ViewLayout } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';

import { SlashPanel } from '../SlashPanel';

const timelineRequiresPro = 'Creating a Timeline view requires a Pro workspace.';
const dashboardRequiresPro = 'Creating a Dashboard view requires a Pro workspace.';
const mockGetSubscriptions = jest.fn();
const mockAddPage = jest.fn();
const mockCreateDatabaseView = jest.fn();
const mockClosePanel = jest.fn();
const mockRemoveContent = jest.fn();
// Stable references: the MUI Popover re-positions whenever its anchor object changes.
const mockPanelContext = {
  isPanelOpen: (type: PanelType) => type === PanelType.Slash,
  panelPosition: { top: 0, left: 0 },
  closePanel: mockClosePanel,
  searchText: '',
  removeContent: mockRemoveContent,
  openPanel: jest.fn(),
};
const mockEditorContext = {
  workspaceId: 'workspace-id',
  viewId: 'document-id',
  addPage: mockAddPage,
  createDatabaseView: mockCreateDatabaseView,
  getSubscriptions: mockGetSubscriptions,
};
const mockAIWriter = { askAIAnything: jest.fn(), continueWriting: jest.fn() };
const mockPopoverContext = { openPopover: jest.fn() };
const mockReasonCalls: { enabled?: boolean; workspaceId?: string; requiresProMessage?: string }[] = [];
let mockRequiresPro = true;

jest.mock('@/application/constants', () => ({
  ...jest.requireActual('@/application/constants'),
  EXPERIMENTAL_DATABASE_VIEW_CREATION_ENABLED: true,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/app/hooks/useTimelineCreationDisabledReason', () => ({
  useTimelineCreationDisabledReason: (
    getSubscriptions: unknown,
    options: { enabled?: boolean; workspaceId?: string; requiresProMessage?: string }
  ) => {
    mockReasonCalls.push(options);
    if (getSubscriptions !== mockGetSubscriptions || !mockRequiresPro) return undefined;
    return options.requiresProMessage ?? timelineRequiresPro;
  },
}));
jest.mock('@/components/app/app.hooks', () => ({ useAIEnabled: () => false }));
jest.mock('@/components/chat', () => ({ useAIWriter: () => mockAIWriter }));
jest.mock('@/components/editor/components/block-popover/BlockPopoverContext', () => ({
  usePopoverContext: () => mockPopoverContext,
}));
jest.mock('@/components/editor/components/panels/Panels.hooks', () => ({ usePanelContext: () => mockPanelContext }));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => mockEditorContext }));

const initialValue: Descendant[] = [{ type: 'paragraph', children: [{ text: '' }] } as Descendant];

const setEmojiPosition = jest.fn();

function SlashPanelHarness() {
  // Selecting an option flushes pending Yjs changes before running it.
  const [editor] = useState(() => Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() }));

  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Editable data-testid='editor' />
      <SlashPanel setEmojiPosition={setEmojiPosition} />
    </Slate>
  );
}

const gatedOptions = [
  ['timeline', timelineRequiresPro],
  ['linkedTimeline', timelineRequiresPro],
  ['dashboard', dashboardRequiresPro],
  ['linkedDashboard', dashboardRequiresPro],
] as const;

describe('SlashPanel Timeline and Dashboard creation access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReasonCalls.length = 0;
    mockRequiresPro = true;
    mockPanelContext.searchText = '';
  });

  it('checks the workspace plan while the menu is open, with the Dashboard message for Dashboard', () => {
    render(<SlashPanelHarness />);

    expect(mockReasonCalls).toContainEqual({ workspaceId: 'workspace-id', enabled: true });
    expect(mockReasonCalls).toContainEqual({
      workspaceId: 'workspace-id',
      enabled: true,
      requiresProMessage: dashboardRequiresPro,
    });
  });

  it.each(gatedOptions)('greys out %s with the Pro reason as its tooltip', async (key, message) => {
    render(<SlashPanelHarness />);
    const option = screen.getByTestId(`slash-menu-${key}`);

    expect(option.hasAttribute('disabled')).toBe(true);
    // The disabled button ignores pointer events; its wrapper must receive hover.
    fireEvent.mouseOver(option.parentElement!);
    expect((await screen.findByRole('tooltip')).textContent).toBe(message);
    fireEvent.click(option);
    expect(mockClosePanel).not.toHaveBeenCalled();
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockCreateDatabaseView).not.toHaveBeenCalled();
  });

  it('keeps other database commands available in a Free workspace', () => {
    render(<SlashPanelHarness />);

    expect(screen.getByTestId('slash-menu-grid').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('slash-menu-list').hasAttribute('disabled')).toBe(false);
  });

  it('shows the reason instead of creating when Enter picks a disabled Dashboard', () => {
    mockPanelContext.searchText = 'dashboard';
    render(<SlashPanelHarness />);

    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Enter' });

    expect(notify.error).toHaveBeenCalledWith(dashboardRequiresPro);
    expect(mockClosePanel).not.toHaveBeenCalled();
    expect(mockRemoveContent).not.toHaveBeenCalled();
    expect(mockAddPage).not.toHaveBeenCalled();
  });

  it('enables Timeline and Dashboard commands in a Pro workspace', async () => {
    mockRequiresPro = false;
    render(<SlashPanelHarness />);

    for (const [key] of gatedOptions) {
      expect(screen.getByTestId(`slash-menu-${key}`).hasAttribute('disabled')).toBe(false);
    }

    fireEvent.click(screen.getByTestId('slash-menu-timeline'));
    expect(mockClosePanel).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockAddPage).toHaveBeenCalledWith('document-id', expect.objectContaining({ layout: ViewLayout.Timeline }))
    );
  });
});
