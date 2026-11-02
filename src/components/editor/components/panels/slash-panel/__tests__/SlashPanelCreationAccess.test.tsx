import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createEditor, Descendant } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { ViewLayout } from '@/application/types';
import type { DatabaseViewCreationAction } from '@/components/app/hooks/useDatabaseViewCreation';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';

import { SlashPanel } from '../SlashPanel';

const memberRequiresPro = 'Ask the workspace owner to upgrade to Pro to create this view.';
const ownerTimelineUpgrade = 'Upgrade this workspace to Pro to create a Timeline view.';
const ownerDashboardUpgrade = 'Upgrade this workspace to Pro to create a Dashboard view.';
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
const mockCreationOptions = jest.fn();
const mockCheckCreation = jest.fn();
let mockRequiresPro = true;
let mockOwner = false;
let mockMobileContext = false;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/app/hooks/useDatabaseViewCreation', () => ({
  useDatabaseViewCreation: (options: unknown) => {
    mockCreationOptions(options);
    // The common hook owns the plan policy, the same for Timeline and Dashboard:
    // a Free owner gets the Pro crown and upgrade, a Free member a denial.
    const getAction = (layout?: ViewLayout): DatabaseViewCreationAction => {
      if (!mockRequiresPro || (layout !== ViewLayout.Timeline && layout !== ViewLayout.Dashboard)) {
        return { type: 'create' };
      }

      if (!mockOwner) return { type: 'disabled', requiresPro: false, reason: memberRequiresPro };
      return {
        type: 'upgrade',
        requiresPro: true,
        reason: layout === ViewLayout.Timeline ? ownerTimelineUpgrade : ownerDashboardUpgrade,
      };
    };

    return {
      getAction,
      checkCreation: (layout?: ViewLayout) => {
        mockCheckCreation(layout);
        return getAction(layout).type === 'create';
      },
    };
  },
}));
jest.mock('@/components/_shared/hooks/useMobileContext', () => ({
  ...jest.requireActual('@/components/_shared/hooks/useMobileContext'),
  useMobileContext: () => mockMobileContext,
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
  ['timeline', ownerTimelineUpgrade],
  ['linkedTimeline', ownerTimelineUpgrade],
  ['dashboard', ownerDashboardUpgrade],
  ['linkedDashboard', ownerDashboardUpgrade],
] as const;

describe('SlashPanel Timeline and Dashboard creation access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequiresPro = true;
    mockOwner = false;
    mockMobileContext = false;
    mockPanelContext.searchText = '';
  });

  it('checks the workspace plan while the menu is open', () => {
    render(<SlashPanelHarness />);

    expect(mockCreationOptions).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      enabled: true,
      getSubscriptions: mockGetSubscriptions,
    });
  });

  it.each(gatedOptions)('greys out %s for a Free member with the ask-owner reason as its tooltip', async (key) => {
    render(<SlashPanelHarness />);
    const option = screen.getByTestId(`slash-menu-${key}`);

    expect(option.getAttribute('aria-disabled')).toBe('true');
    // The shared admission path keeps clicks actionable so it can explain the
    // denial and refresh status, for Dashboard as for Timeline.
    expect(option.hasAttribute('disabled')).toBe(false);
    expect(within(option).queryByLabelText('Pro')).toBeNull();
    fireEvent.pointerMove(option.parentElement!, { pointerType: 'mouse' });
    expect((await screen.findByRole('tooltip')).textContent).toBe(memberRequiresPro);
    fireEvent.click(option);
    expect(mockCheckCreation).toHaveBeenCalledWith(key.toLowerCase().includes('dashboard') ? ViewLayout.Dashboard : ViewLayout.Timeline);
    expect(mockClosePanel).not.toHaveBeenCalled();
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockCreateDatabaseView).not.toHaveBeenCalled();
  });

  it.each(gatedOptions)('shows the Pro crown on %s for a Free owner, with the upgrade reason', async (key, message) => {
    mockOwner = true;
    render(<SlashPanelHarness />);
    const option = screen.getByTestId(`slash-menu-${key}`);

    expect(option.getAttribute('aria-disabled')).toBe('false');
    expect(within(option).getByLabelText('Pro')).toBeTruthy();
    fireEvent.pointerMove(option.parentElement!, { pointerType: 'mouse' });
    expect((await screen.findByRole('tooltip')).textContent).toBe(message);
    fireEvent.click(option);
    expect(mockCheckCreation).toHaveBeenCalledWith(key.toLowerCase().includes('dashboard') ? ViewLayout.Dashboard : ViewLayout.Timeline);
    expect(mockAddPage).not.toHaveBeenCalled();
    expect(mockCreateDatabaseView).not.toHaveBeenCalled();
  });

  it('keeps other database commands available in a Free workspace', () => {
    render(<SlashPanelHarness />);

    expect(screen.getByTestId('slash-menu-grid').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('slash-menu-list').hasAttribute('disabled')).toBe(false);
  });

  it('runs the shared admission check instead of creating when Enter picks a refused Dashboard', () => {
    mockPanelContext.searchText = 'dashboard';
    render(<SlashPanelHarness />);

    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Enter' });

    expect(mockCheckCreation).toHaveBeenCalledWith(ViewLayout.Dashboard);
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

  describe('in a mobile context (dashboards are view-only there)', () => {
    beforeEach(() => {
      mockMobileContext = true;
      mockRequiresPro = false;
    });

    it('offers no Dashboard command, like the tab "+" menu and the layout switcher', () => {
      render(<SlashPanelHarness />);

      expect(screen.queryByTestId('slash-menu-dashboard')).toBeNull();
      expect(screen.queryByTestId('slash-menu-linkedDashboard')).toBeNull();
      // Every other database command is still there.
      expect(screen.getByTestId('slash-menu-grid')).toBeTruthy();
      expect(screen.getByTestId('slash-menu-timeline').hasAttribute('disabled')).toBe(false);
      expect(screen.getByTestId('slash-menu-linkedTimeline')).toBeTruthy();
    });

    it('creates no dashboard when "/dashboard" is typed and Enter is pressed', () => {
      mockPanelContext.searchText = 'dashboard';
      render(<SlashPanelHarness />);

      fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Enter' });

      expect(mockAddPage).not.toHaveBeenCalled();
      expect(mockCreateDatabaseView).not.toHaveBeenCalled();
    });
  });
});
