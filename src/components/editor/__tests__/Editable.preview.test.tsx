import { cleanup, render } from '@testing-library/react';
import { ReactNode } from 'react';

import EditorEditable from '../Editable';
import { EditorPreviewContextProvider } from '../EditorPreviewContext';

const mockEditor = { children: [] };
let mockEditorDom: HTMLDivElement;

jest.mock('slate-react', () => ({
  useSlate: () => mockEditor,
  ReactEditor: { toDOMNode: () => mockEditorDom },
  Editable: () => <div />,
}));
jest.mock('../EditorContext', () => ({
  useEditorContext: () => ({ readOnly: true, viewId: 'row', workspaceId: 'workspace' }),
  useEditorLocalState: () => ({}),
}));
jest.mock('../shortcut.hooks', () => ({ useShortcuts: () => ({}) }));
jest.mock('../components/blocks/code/useDecorate', () => ({ useDecorate: () => () => [] }));
jest.mock('../components/find-replace/FindReplaceContext', () => ({
  useFindReplaceDecorations: () => ({ getMatchDecorations: () => [] }),
}));
jest.mock('../components/element', () => ({ Element: () => null }));
jest.mock('../components/leaf', () => ({ Leaf: () => null }));
jest.mock('../components/leaf/href/HrefPopover', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/panels/PanelsContext', () => ({
  PanelProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../components/block-popover/BlockPopoverContext', () => ({
  BlockPopoverProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../components/remote-selections', () => ({ RemoteSelectionsLayer: () => null }));
jest.mock('@/components/inline-comment/editor/InlineCommentEditorControls', () => ({
  InlineCommentEditorControls: () => null,
}));

describe('Editor preview auto-scroll ownership', () => {
  let scroller: HTMLDivElement;

  beforeEach(() => {
    scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
    mockEditorDom = document.createElement('div');
    scroller.appendChild(mockEditorDom);
    document.body.appendChild(scroller);
  });

  afterEach(() => {
    cleanup();
    scroller.remove();
    jest.restoreAllMocks();
  });

  it('preserves the host registration while previews sharing its scroll container mount and unmount', () => {
    // Use the actual Atlaskit registration: its cleanup deletes the shared
    // element registration and marker, even if another editor still needs it.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = render(<EditorEditable />);

    expect(scroller.getAttribute('data-auto-scrollable')).toBe('true');

    const firstPreview = render(
      <EditorPreviewContextProvider enabled>
        <EditorEditable />
      </EditorPreviewContextProvider>
    );
    const secondPreview = render(
      <EditorPreviewContextProvider enabled>
        <EditorEditable />
      </EditorPreviewContextProvider>
    );

    firstPreview.unmount();
    expect(scroller.getAttribute('data-auto-scrollable')).toBe('true');
    secondPreview.unmount();
    expect(scroller.getAttribute('data-auto-scrollable')).toBe('true');
    expect(warn).not.toHaveBeenCalled();

    host.unmount();
    expect(scroller.hasAttribute('data-auto-scrollable')).toBe(false);
  });

  it('does not register a preview without a host editor', () => {
    const preview = render(
      <EditorPreviewContextProvider enabled>
        <EditorEditable />
      </EditorPreviewContextProvider>
    );

    expect(scroller.hasAttribute('data-auto-scrollable')).toBe(false);
    preview.unmount();
    expect(scroller.hasAttribute('data-auto-scrollable')).toBe(false);
  });
});
