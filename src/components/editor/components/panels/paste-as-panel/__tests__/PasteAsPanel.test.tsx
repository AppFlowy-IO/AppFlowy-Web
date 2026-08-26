import { act, fireEvent, render, screen } from '@testing-library/react';
import { createEditor, Editor, Transforms } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { BlockType, Mention, MentionType } from '@/application/types';

import { PasteAsMenuType } from '../constants';
import { PasteAsPanel } from '../PasteAsPanel';

const workspaceId = '3df0c6bb-417f-4f81-939a-c6114f160f9a';
const databaseViewId = 'b709de16-f480-43cb-a175-03b1808449cf';
const rowId = '439bd5d7-6b22-4117-8465-539dcc6c55d9';
const rowPageUrl = `http://localhost/app/${workspaceId}/${databaseViewId}?r=${rowId}`;

let mockEditor: YjsEditor;
const mockClosePanel = jest.fn();
const mockFocus = jest.fn();
const mockGetPasteAsPayload = jest.fn();
const mockLoadView = jest.fn();
const mockResolveDatabaseRowPageMention = jest.fn();
const mockSlateDom = document.createElement('div');
const mockPanelPosition = { left: 0, top: 0 };

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '',
  }),
}));

jest.mock('slate-react', () => ({
  ReactEditor: {
    focus: (...args: unknown[]) => mockFocus(...args),
    toDOMNode: () => mockSlateDom,
  },
  useSlateStatic: () => mockEditor,
}));

jest.mock('@mui/material', () => ({
  Button: ({
    children,
    onClick,
    onMouseEnter,
    'data-testid': testId,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    onMouseEnter?: () => void;
    'data-testid'?: string;
  }) => (
    <button data-testid={testId} onClick={onClick} onMouseEnter={onMouseEnter}>
      {children}
    </button>
  ),
}));

jest.mock('@/components/_shared/popover', () => ({
  calculateOptimalOrigins: () => ({ transformOrigin: { horizontal: 'left', vertical: 'top' } }),
  Popover: ({ children, open }: { children: React.ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
}));

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({
    loadView: mockLoadView,
    workspaceId,
  }),
}));

jest.mock('@/components/editor/components/panels/Panels.hooks', () => ({
  usePanelContext: () => ({
    closePanel: mockClosePanel,
    getPasteAsPayload: mockGetPasteAsPayload,
    isPanelOpen: () => true,
    panelPosition: mockPanelPosition,
  }),
}));

jest.mock('../databaseRowMention', () => ({
  resolveDatabaseRowPageMention: (...args: unknown[]) => mockResolveDatabaseRowPageMention(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe('PasteAsPanel async mention resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createEditor() as YjsEditor;
    mockEditor.children = [
      {
        type: BlockType.Paragraph,
        blockId: 'paragraph-1',
        children: [{ text: rowPageUrl, href: rowPageUrl }],
      },
    ];

    const range = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: rowPageUrl.length },
    };

    mockEditor.selection = range;
    mockGetPasteAsPayload.mockReturnValue({ range, url: rowPageUrl });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not mutate or refocus a detached editor after row resolution completes', async () => {
    const resolution = deferred<Mention | null>();
    const deleteSpy = jest.spyOn(Transforms, 'delete');
    const insertNodesSpy = jest.spyOn(Transforms, 'insertNodes');

    mockResolveDatabaseRowPageMention.mockReturnValue(resolution.promise);

    const { unmount } = render(<PasteAsPanel />);

    fireEvent.click(screen.getByTestId(`paste-as-${PasteAsMenuType.Mention}`));

    expect(mockResolveDatabaseRowPageMention).toHaveBeenCalledTimes(1);
    expect(mockClosePanel).toHaveBeenCalledTimes(1);
    expect(mockFocus).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      resolution.resolve({
        type: MentionType.PageRef,
        page_id: databaseViewId,
        row_id: rowId,
        data: { title: 'PRJ-001' },
      });
      await resolution.promise;
    });

    expect(mockFocus).toHaveBeenCalledTimes(1);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(insertNodesSpy).not.toHaveBeenCalled();
    expect(mockEditor.string([])).toBe(rowPageUrl);
  });

  it('replaces the tracked URL without moving a selection the user made while resolving', async () => {
    const resolution = deferred<Mention | null>();
    const prefix = 'Inside a Project page (example: ';

    mockEditor.children = [
      {
        type: BlockType.Paragraph,
        blockId: 'paragraph-1',
        children: [{ text: prefix }, { text: rowPageUrl, href: rowPageUrl }, { text: ' keep editing' }],
      },
    ];
    const pasteRange = {
      anchor: { path: [0, 1], offset: 0 },
      focus: { path: [0, 1], offset: rowPageUrl.length },
    };

    mockEditor.selection = pasteRange;
    mockGetPasteAsPayload.mockReturnValue({ range: pasteRange, url: rowPageUrl });
    mockResolveDatabaseRowPageMention.mockReturnValue(resolution.promise);

    render(<PasteAsPanel />);

    fireEvent.click(screen.getByTestId(`paste-as-${PasteAsMenuType.Mention}`));

    const liveSelection = {
      anchor: { path: [0, 2], offset: 6 },
      focus: { path: [0, 2], offset: 6 },
    };

    Transforms.select(mockEditor, liveSelection);
    const expectedSelectionRef = Editor.rangeRef(mockEditor, liveSelection);

    await act(async () => {
      resolution.resolve({
        type: MentionType.PageRef,
        page_id: databaseViewId,
        row_id: rowId,
        data: { title: 'PRJ-001' },
      });
      await resolution.promise;
    });

    expect(mockFocus).toHaveBeenCalledTimes(1);
    expect(mockEditor.selection).toEqual(expectedSelectionRef.unref());
    expect(mockEditor.string([])).toBe(`${prefix}@ keep editing`);
    const mentionNode = Editor.nodes(mockEditor, {
      at: [],
      match: (node) => 'mention' in node,
    }).next().value?.[0] as { mention?: Mention } | undefined;

    expect(mentionNode?.mention).toMatchObject({
      type: MentionType.PageRef,
      row_id: rowId,
      data: { title: 'PRJ-001' },
    });
  });
});
