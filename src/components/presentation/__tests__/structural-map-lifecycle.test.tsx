import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import PresentationStudio from '../PresentationStudio';
import { createGenerationRunner, editMap, loadPresentation, loadStructuralMap, saveSession } from '../presentation-client';

import type { Artifact } from '../server-contract';
import type { MindMap, PageSnapshot } from '../types';

type ViewerProps = { map: MindMap; onMapChange?: (map: MindMap) => Promise<void> };
let mockViewerProps: ViewerProps | undefined;
const mockRunGeneration = jest.fn();

jest.mock('../presentation-client', () => ({
  PresentationAPIError: class extends Error {},
  createGenerationRunner: jest.fn(),
  loadPresentation: jest.fn(),
  loadStructuralMap: jest.fn(),
  editMap: jest.fn(),
  saveSession: jest.fn(),
  serverOptions: jest.fn(() => ({})),
  styleReference: jest.fn(),
  themeToStyle: (theme: unknown) => theme,
}));
jest.mock('../MindMapViewer', () => ({
  __esModule: true,
  default: (props: ViewerProps) => {
    mockViewerProps = props;
    return <div data-testid='server-map'>{props.map.nodes.map((node) => node.label).join(', ')}</div>;
  },
}));
jest.mock('../SlidesWorkflow', () => ({ __esModule: true, default: () => null }));
jest.mock('../StyleSettings', () => ({ __esModule: true, default: () => null }));
jest.mock('../DocumentPresenter', () => ({ __esModule: true, default: () => null, BlockContent: () => null }));
jest.mock('../DocumentContentProvider', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../DocumentOutline', () => ({
  DocumentOutlineContext: jest.requireActual<typeof import('react')>('react').createContext({}),
}));
jest.mock('../document-outline', () => ({ documentOutline: () => ({ headings: [] }) }));
jest.mock('../mindmap-references', () => ({ resolveMapReferences: () => new Map() }));
jest.mock('../source', () => ({ flattenBlocks: () => [], splitDocument: () => [] }));
jest.mock('../ui', () => ({
  Action: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../PresentationPaywall', () => ({ __esModule: true, default: () => null }));
jest.mock('@mui/material/Dialog', () => ({ __esModule: true, default: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

function source(pageId = 'page-a', revision = 'revision-a'): PageSnapshot {
  return {
    pageId,
    revision,
    title: 'Test source',
    kind: 'document',
    blocks: [],
    properties: [],
    warnings: [],
    serverSource: { revision, references: {} },
  } as unknown as PageSnapshot;
}

function artifact(label: string, snapshot = source()): Artifact<MindMap> {
  return {
    id: 'server-artifact',
    version: 1,
    workspaceId: 'workspace-a',
    sourceRevision: snapshot.revision,
    origin: 'structural',
    mapStyle: { structure: 'right-facing', branchLine: 'rounded' },
    content: {
      schemaVersion: 1,
      warnings: [],
      nodes: [{ id: 'node', parentId: null, label, summary: '', sourceIds: [snapshot.pageId] }],
    },
  } as Artifact<MindMap>;
}

const status = {
  plan: 'paid',
  remainingSlides: 100,
  maxSlides: 100,
  themes: [],
  usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 },
  aiResponses: { accountingReady: true, remaining: 1, limit: 1 },
};
const props = () => ({
  workspaceId: 'workspace-a',
  userId: 'user-a',
  snapshot: source(),
  initialMode: 'mindmap' as const,
  canWrite: true,
});

beforeEach(() => {
  jest.resetAllMocks();
  mockViewerProps = undefined;
  jest.mocked(createGenerationRunner).mockReturnValue(mockRunGeneration);
  jest.mocked(loadPresentation).mockResolvedValue({ status, session: null, decks: [], styles: [] } as never);
  jest.mocked(saveSession).mockResolvedValue({ revision: 1 } as never);
});

test('waits for the real structural artifact without a local map or a model call', async () => {
  const request = deferred<Artifact<MindMap>>();

  jest.mocked(loadStructuralMap).mockReturnValue(request.promise);
  render(<PresentationStudio {...props()} />);
  expect(screen.getByText('Loading page structure…')).toBeTruthy();
  expect(screen.queryByTestId('server-map')).toBeNull();
  await act(async () => request.resolve(artifact('Server structure')));
  expect((await screen.findByTestId('server-map')).textContent).toBe('Server structure');
  expect(mockViewerProps?.onMapChange).toBeDefined();
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test('shows a structural endpoint failure and retries that endpoint without generating content', async () => {
  jest
    .mocked(loadStructuralMap)
    .mockRejectedValueOnce(new Error('Source access changed'))
    .mockResolvedValueOnce(artifact('Retried structure'));
  render(<PresentationStudio {...props()} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Source access changed');
  expect(screen.queryByTestId('server-map')).toBeNull();
  fireEvent.click(screen.getByText('Retry page structure'));
  expect((await screen.findByTestId('server-map')).textContent).toBe('Retried structure');
  expect(loadStructuralMap).toHaveBeenCalledTimes(2);
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test('shows an empty response without fabricating a root node', async () => {
  const empty = artifact('unused');

  empty.content.nodes = [];
  jest.mocked(loadStructuralMap).mockResolvedValue(empty);
  render(<PresentationStudio {...props()} />);
  await screen.findByText('The source has no content to show as a mind map.');
  expect(screen.queryByTestId('server-map')).toBeNull();
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test('readers do not call the structural mutation endpoint but can view an authorized saved map', async () => {
  const saved = artifact('Authorized saved map');

  jest
    .mocked(loadPresentation)
    .mockResolvedValue({
      status,
      session: null,
      decks: [],
      styles: [],
      map: saved.content,
      mapArtifact: saved,
    } as never);
  render(<PresentationStudio {...props()} canWrite={false} />);
  await screen.findByText(/Editor access is required to create a map from page structure/);
  expect(screen.queryByTestId('server-map')).toBeNull();
  const savedButton = screen.getByText('Saved mind map');

  await waitFor(() => expect((savedButton as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(savedButton);
  expect((await screen.findByTestId('server-map')).textContent).toBe('Authorized saved map');
  expect(mockViewerProps?.onMapChange).toBeUndefined();
  expect(loadStructuralMap).not.toHaveBeenCalled();
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test.each(['workspace', 'actor', 'page', 'revision'] as const)(
  'hides a previous artifact immediately on %s change and ignores its delayed response',
  async (change) => {
    const old = deferred<Artifact<MindMap>>();
    const next = deferred<Artifact<MindMap>>();
    const initial = props();

    jest.mocked(loadStructuralMap).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const view = render(<PresentationStudio {...initial} />);
    const oldSignal = jest.mocked(loadStructuralMap).mock.calls[0][3]!;
    const changed = {
      ...initial,
      ...(change === 'workspace' && { workspaceId: 'workspace-b' }),
      ...(change === 'actor' && { userId: 'user-b' }),
      ...(change === 'page' && { snapshot: source('page-b') }),
      ...(change === 'revision' && { snapshot: source('page-a', 'revision-b') }),
    };

    view.rerender(<PresentationStudio {...changed} />);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => old.resolve(artifact('Old source response')));
    expect(screen.queryByTestId('server-map')).toBeNull();
    expect(screen.getByText('Loading page structure…')).toBeTruthy();
    await act(async () => next.resolve(artifact('Current source response', changed.snapshot)));
    expect((await screen.findByTestId('server-map')).textContent).toBe('Current source response');
  }
);

test('removes a ready artifact on source revision change before the replacement completes', async () => {
  const next = deferred<Artifact<MindMap>>();
  const initial = props();

  jest.mocked(loadStructuralMap).mockResolvedValueOnce(artifact('Old ready map')).mockReturnValueOnce(next.promise);
  const view = render(<PresentationStudio {...initial} />);

  await screen.findByTestId('server-map');
  view.rerender(<PresentationStudio {...initial} snapshot={source('page-a', 'revision-b')} />);
  expect(screen.queryByTestId('server-map')).toBeNull();
  await act(async () => next.resolve(artifact('Fresh map')));
  expect((await screen.findByTestId('server-map')).textContent).toBe('Fresh map');
});

test('revoking editor access aborts pending structure reads and hides their result', async () => {
  const request = deferred<Artifact<MindMap>>();
  const initial = props();

  jest.mocked(loadStructuralMap).mockReturnValue(request.promise);
  const view = render(<PresentationStudio {...initial} />);
  const signal = jest.mocked(loadStructuralMap).mock.calls[0][3]!;

  view.rerender(<PresentationStudio {...initial} canWrite={false} />);
  expect(signal.aborted).toBe(true);
  await act(async () => request.resolve(artifact('Revoked response')));
  expect(screen.queryByTestId('server-map')).toBeNull();
  expect(screen.getByText(/Editor access is required/)).toBeTruthy();
});

test('a delayed edit cannot restore or select a map after its source changes', async () => {
  const edit = deferred<Artifact<MindMap>>();
  const next = deferred<Artifact<MindMap>>();
  const initial = props();

  jest.mocked(loadStructuralMap).mockResolvedValueOnce(artifact('Initial map')).mockReturnValueOnce(next.promise);
  jest.mocked(editMap).mockReturnValue(edit.promise);
  const view = render(<PresentationStudio {...initial} />);

  await screen.findByTestId('server-map');
  const saving = mockViewerProps!.onMapChange!(artifact('Edited map').content);

  view.rerender(<PresentationStudio {...initial} snapshot={source('page-a', 'revision-b')} />);
  await act(async () => {
    edit.resolve(artifact('Late edit'));
    await expect(saving).rejects.toThrow('The source or your access changed');
  });
  expect(screen.queryByTestId('server-map')).toBeNull();
  expect(saveSession).not.toHaveBeenCalled();
});
