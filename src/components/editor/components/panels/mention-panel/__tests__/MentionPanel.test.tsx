import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Editor, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';

import { View, ViewLayout } from '@/application/types';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';

import { MentionPanel } from '../MentionPanel';

const mockClosePanel = jest.fn();
const mockRemoveContent = jest.fn();
const mockAddMark = jest.fn();
const mockTranslate = (key: string) => key;
const mockLoadViews = jest.fn();
const mockPanelContext = {
  activePanel: PanelType.PageReference,
  isPanelOpen: (panel: PanelType) => panel === PanelType.PageReference,
  panelPosition: { top: 0, left: 0 },
  searchText: 'Target',
  closePanel: mockClosePanel,
  removeContent: mockRemoveContent,
};
const mockEditorContext = { workspaceId: 'workspace', loadViews: mockLoadViews };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: {} }));
jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { addMark: (...args: unknown[]) => mockAddMark(...args) },
}));
jest.mock('@/components/editor/components/panels/Panels.hooks', () => ({
  usePanelContext: () => mockPanelContext,
}));
jest.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => mockEditorContext }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => undefined }));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid='mention-panel'>{children}</div> : null,
  calculateOptimalOrigins: () => ({ transformOrigin: { vertical: 'top', horizontal: 'left' } }),
}));

describe('MentionPanel composition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadViews.mockResolvedValue([{ view_id: 'target-page', name: 'Target', layout: ViewLayout.Document } as View]);
  });

  afterEach(cleanup);

  it.each([false, true])('leaves composing Enter to the IME (highlighted result: %s)', async (highlighted) => {
    const editor = Object.assign(withReact(createEditor()), { flushLocalChanges: jest.fn() });

    render(
      <Slate editor={editor} initialValue={[{ type: 'paragraph', children: [{ text: '@Target' }] }]}>
        {/* The native panel listener runs before the host's composition guard. */}
        <Editable data-testid='editor' onKeyDown={(event) => event.nativeEvent.isComposing} />
        <MentionPanel />
      </Slate>
    );
    const editable = screen.getByTestId('editor');
    const option = await screen.findByRole('button', { name: 'Target' });

    Object.defineProperty(option, 'scrollIntoView', { value: jest.fn() });
    await act(async () => {
      Transforms.select(editor, Editor.end(editor, []));
    });
    if (highlighted) {
      await act(async () => {
        fireEvent.keyDown(editable, { key: 'ArrowDown' });
      });
      expect(option.getAttribute('data-selected')).toBe('true');
    }

    const confirmation = new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      which: 13,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      fireEvent(editable, confirmation);
    });
    expect(confirmation.defaultPrevented).toBe(false);
    expect(mockClosePanel).not.toHaveBeenCalled();
    expect(mockRemoveContent).not.toHaveBeenCalled();
    expect(mockAddMark).not.toHaveBeenCalled();
    expect(Editor.string(editor, [])).toBe('@Target');

    if (highlighted) {
      await act(async () => {
        fireEvent.keyDown(editable, { key: 'Enter', keyCode: 13, which: 13 });
      });
      expect(mockClosePanel).toHaveBeenCalledTimes(1);
      expect(mockRemoveContent).toHaveBeenCalledTimes(1);
      expect(mockAddMark).toHaveBeenCalledTimes(1);
    }
  });
});
