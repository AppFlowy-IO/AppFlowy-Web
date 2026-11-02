import { act, render, screen } from '@testing-library/react';

import type { YjsEditor } from '@/application/slate-yjs';
import type { LoadView, ViewMetaProps, YDoc } from '@/application/types';
import DrawerContent from '@/components/ai-chat/DrawerContent';

const mockLoadView = jest.fn<ReturnType<LoadView>, Parameters<LoadView>>();
const mockBindViewSync = jest.fn();
const mockInsertDataToDoc = jest.fn();
const mockGetInsertData = jest.fn();
const mockClearInsertData = jest.fn();
let mockWorkspaceId = 'workspace-A';

interface DocumentProps {
  doc: YDoc;
  viewMeta: ViewMetaProps;
  onEditorConnected: (editor: YjsEditor) => void;
}

const mockDocument = jest.fn(({ doc, viewMeta }: DocumentProps) => (
  <output data-testid='document'>
    {JSON.stringify({ documentId: (doc as YDoc & { view_id: string }).view_id, viewId: viewMeta.viewId })}
  </output>
));
const mockOperations = { loadView: mockLoadView, bindViewSync: mockBindViewSync };
const mockChatContext = {
  getInsertData: mockGetInsertData,
  clearInsertData: mockClearInsertData,
  drawerOpen: true,
};

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => mockOperations,
  useOpenPageModal: () => undefined,
  useLoadViews: () => undefined,
  useAppView: (id: string) => ({ view_id: id, name: id, layout: 0 }),
  useCurrentWorkspaceId: () => mockWorkspaceId,
}));
jest.mock('@/components/ai-chat/AIChatProvider', () => ({ useAIChatContext: () => mockChatContext }));
jest.mock('@/components/ai-chat/utils', () => ({
  insertDataToDoc: (...args: unknown[]) => mockInsertDataToDoc(...args),
}));
jest.mock('@/application/slate-yjs', () => ({}));
jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => undefined }));
jest.mock('@/components/document', () => ({ Document: (props: DocumentProps) => mockDocument(props) }));
jest.mock('@/components/error/RecordNotFound', () => ({
  __esModule: true,
  default: ({ viewId }: { viewId: string }) => <output data-testid='not-found'>{viewId}</output>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function documentFor(viewId: string): YDoc {
  return { view_id: viewId } as unknown as YDoc;
}

function latestDocumentProps() {
  return mockDocument.mock.calls[mockDocument.mock.calls.length - 1][0];
}

describe('DrawerContent source ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceId = 'workspace-A';
    mockLoadView.mockImplementation(async (id: string) => documentFor(id));
    mockBindViewSync.mockReturnValue({});
    mockGetInsertData.mockReturnValue(undefined);
  });

  it('loads, binds and renders the active source', async () => {
    render(<DrawerContent openViewId='A' />);
    await act(async () => undefined);

    expect(mockLoadView).toHaveBeenCalledWith('A', false, false, { signal: expect.any(AbortSignal) });
    expect(mockBindViewSync).toHaveBeenCalledWith(documentFor('A'));
    expect(screen.getByTestId('document').textContent).toBe(JSON.stringify({ documentId: 'A', viewId: 'A' }));
  });

  it('ignores an old source response after the next source has loaded', async () => {
    const first = deferred<YDoc>();
    const second = deferred<YDoc>();

    mockLoadView.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<DrawerContent openViewId='A' />);

    view.rerender(<DrawerContent openViewId='B' />);
    expect(mockLoadView.mock.calls[0][3]?.signal?.aborted).toBe(true);
    await act(async () => second.resolve(documentFor('B')));
    await act(async () => first.resolve(documentFor('A')));

    expect(screen.getByTestId('document').textContent).toBe(JSON.stringify({ documentId: 'B', viewId: 'B' }));
    expect(mockBindViewSync).not.toHaveBeenCalledWith(documentFor('A'));
  });

  it('ignores an obsolete failure instead of hiding the next document', async () => {
    const first = deferred<YDoc>();
    const second = deferred<YDoc>();
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockLoadView.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<DrawerContent openViewId='A' />);

    view.rerender(<DrawerContent openViewId='B' />);
    await act(async () => second.resolve(documentFor('B')));
    await act(async () => first.reject(new Error('A unavailable')));

    expect(screen.queryByTestId('not-found')).toBeNull();
    expect(screen.getByTestId('document').textContent).toBe(JSON.stringify({ documentId: 'B', viewId: 'B' }));
    errorLog.mockRestore();
  });

  it('reloads the same source for a new workspace and ignores the old workspace response', async () => {
    const first = deferred<YDoc>();
    const second = deferred<YDoc>();
    const oldDoc = documentFor('source');
    const newDoc = documentFor('source');

    mockLoadView.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<DrawerContent openViewId='source' />);

    mockWorkspaceId = 'workspace-B';
    view.rerender(<DrawerContent openViewId='source' />);
    await act(async () => second.resolve(newDoc));
    await act(async () => first.resolve(oldDoc));

    expect(mockLoadView).toHaveBeenCalledTimes(2);
    expect(latestDocumentProps().doc).toBe(newDoc);
    expect(mockBindViewSync.mock.calls.every(([doc]) => doc !== oldDoc)).toBe(true);
  });

  it('does not reuse the previous document while the same source loads in a new workspace', async () => {
    const next = deferred<YDoc>();
    const view = render(<DrawerContent openViewId='source' />);

    await act(async () => undefined);
    mockLoadView.mockReturnValue(next.promise);
    mockWorkspaceId = 'workspace-B';
    view.rerender(<DrawerContent openViewId='source' />);

    expect(screen.queryByTestId('document')).toBeNull();
    await act(async () => next.resolve(documentFor('source')));
  });

  it('does not accept the first visit to A after navigating A to B to A', async () => {
    const oldA = deferred<YDoc>();
    const b = deferred<YDoc>();
    const newA = deferred<YDoc>();

    mockLoadView.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(newA.promise);
    const view = render(<DrawerContent openViewId='A' />);

    view.rerender(<DrawerContent openViewId='B' />);
    view.rerender(<DrawerContent openViewId='A' />);
    await act(async () => oldA.resolve(documentFor('A')));
    expect(screen.queryByTestId('document')).toBeNull();
    await act(async () => newA.resolve(documentFor('A')));
    await act(async () => b.resolve(documentFor('B')));
    expect(screen.getByTestId('document').textContent).toBe(JSON.stringify({ documentId: 'A', viewId: 'A' }));
  });

  it('waits for the new document editor before inserting generated content', async () => {
    const view = render(<DrawerContent openViewId='A' />);

    await act(async () => undefined);
    const oldConnected = latestDocumentProps().onEditorConnected;
    const oldEditor = { deselect: jest.fn() } as unknown as YjsEditor;

    await act(async () => oldConnected(oldEditor));
    mockGetInsertData.mockImplementation((id: string) => (id === 'B' ? [{ type: 'paragraph' }] : undefined));
    view.rerender(<DrawerContent openViewId='B' />);
    await act(async () => undefined);
    await act(async () => oldConnected(oldEditor));

    expect(mockInsertDataToDoc).not.toHaveBeenCalled();
    const newEditor = { deselect: jest.fn() } as unknown as YjsEditor;

    await act(async () => latestDocumentProps().onEditorConnected(newEditor));
    await act(async () => oldConnected(oldEditor));
    expect(oldEditor.deselect).not.toHaveBeenCalled();
    expect(newEditor.deselect).toHaveBeenCalledTimes(1);
    expect(mockInsertDataToDoc).toHaveBeenCalledWith(latestDocumentProps().doc, [{ type: 'paragraph' }]);
    expect(mockClearInsertData).toHaveBeenCalledWith('B');
  });

  it('does not render or bind a document whose routing identity differs from its metadata', async () => {
    mockLoadView.mockResolvedValue(documentFor('different-source'));
    render(<DrawerContent openViewId='A' />);
    await act(async () => undefined);

    expect(screen.queryByTestId('document')).toBeNull();
    expect(mockBindViewSync).not.toHaveBeenCalled();
  });

  it('shows failures belonging to the current source', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockLoadView.mockRejectedValue(new Error('Current source unavailable'));
    render(<DrawerContent openViewId='A' />);
    await act(async () => undefined);

    expect(screen.getByTestId('not-found').textContent).toBe('A');
    errorLog.mockRestore();
  });

  it('does not bind or insert a source that finishes loading after unmount', async () => {
    const pending = deferred<YDoc>();

    mockLoadView.mockReturnValue(pending.promise);
    const view = render(<DrawerContent openViewId='A' />);

    view.unmount();
    expect(mockLoadView.mock.calls[0][3]?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(documentFor('A')));
    expect(mockBindViewSync).not.toHaveBeenCalled();
    expect(mockInsertDataToDoc).not.toHaveBeenCalled();
  });
});
