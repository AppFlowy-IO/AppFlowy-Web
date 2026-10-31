import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { aiMapUnavailableReason } from '../ai-map-availability';
import PresentationStudio from '../PresentationStudio';
import { createGenerationRunner, loadPresentation, loadStructuralMap, saveSession } from '../presentation-client';

import type { Artifact, PresentationStatus } from '../server-contract';
import type { MindMap, PageSnapshot } from '../types';

type ViewerProps = {
  map: MindMap;
  origin?: string;
  canGenerate: boolean;
  generationPaywall?: string;
  onUpgrade?: () => void;
  onMapChange?: (map: MindMap) => Promise<void>;
  onClosePresentation?: () => void;
};
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
    const Paywall = jest.requireActual('../PresentationPaywall').default;

    return <div data-testid='server-map'>{props.map.nodes.map((node) => node.label).join(', ')}{props.generationPaywall && <Paywall message={props.generationPaywall} onUpgrade={props.onUpgrade} />}</div>;
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
jest.mock('@mui/material/Dialog', () => ({ __esModule: true, default: () => null }));

function source(): PageSnapshot {
  return {
    pageId: 'page-a',
    revision: 'revision-a',
    title: 'Test source',
    kind: 'document',
    blocks: [],
    properties: [],
    warnings: [],
    serverSource: { revision: 'revision-a', references: {} },
  } as unknown as PageSnapshot;
}

function map(id: string, label: string, origin: 'ai' | 'structural'): Artifact<MindMap> {
  return {
    id,
    version: 1,
    workspaceId: 'workspace-a',
    sourceRevision: 'revision-a',
    origin,
    mapStyle: { structure: 'right-facing', branchLine: 'rounded' },
    content: {
      schemaVersion: 1,
      warnings: [],
      nodes: [{ id: 'node', parentId: null, label, summary: '', sourceIds: ['page-a'] }],
    },
  } as Artifact<MindMap>;
}

function status(aiResponses: PresentationStatus['aiResponses']): PresentationStatus {
  return {
    plan: 'paid',
    remainingSlides: 100,
    maxSlides: 100,
    themes: [],
    usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 },
    aiResponses,
  } as unknown as PresentationStatus;
}

const notReady = status({ metered: true, accountingReady: false });
const available = status({ metered: true, accountingReady: true, limit: 5, remaining: 2 });
const loaded = (value: PresentationStatus, saved?: Artifact<MindMap>) =>
  ({ status: value, session: null, decks: [], styles: [], map: saved?.content, mapArtifact: saved } as never);
const props = () => ({
  workspaceId: 'workspace-a',
  userId: 'user-a',
  snapshot: source(),
  initialMode: 'mindmap' as const,
  canWrite: true,
});

test('shared AI exhaustion offers Upgrade while the saved map remains readable', async () => {
  const onUpgrade = jest.fn();

  jest.mocked(loadPresentation).mockResolvedValue(loaded(status({ accountingReady: true, limit: 20, remaining: 0 }), map('saved', 'Saved content', 'ai')));
  render(<PresentationStudio {...props()} onUpgrade={onUpgrade} presentMindMap />);
  await screen.findByText(/Saved content/);
  fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));
  expect(onUpgrade).toHaveBeenCalledTimes(1);
  expect(mockViewerProps?.canGenerate).toBe(false);
  expect(mockRunGeneration).not.toHaveBeenCalled();
  expect(screen.getByText(/Saved content/)).toBeTruthy();
});

test.each([
  [{ accountingReady: false, retryable: true }, false],
  [{ accountingReady: true, limit: null, remaining: null }, true],
  [{ unlimited: true, accountingReady: true, limit: 20, remaining: 0 }, true],
  [{ metered: false }, true],
])('AI availability %j does not offer an upgrade', async (ai, canGenerate) => {
  jest.mocked(loadPresentation).mockResolvedValue(loaded(status(ai), map('saved', 'Saved content', 'ai')));
  render(<PresentationStudio {...props()} onUpgrade={jest.fn()} presentMindMap />);
  await screen.findByText('Saved content');
  expect(mockViewerProps?.canGenerate).toBe(canGenerate);
  expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
});

beforeEach(() => {
  jest.resetAllMocks();
  mockViewerProps = undefined;
  jest.mocked(createGenerationRunner).mockReturnValue(mockRunGeneration);
  jest.mocked(saveSession).mockResolvedValue({ revision: 1 } as never);
  jest.mocked(loadStructuralMap).mockResolvedValue(map('structure', 'Page structure', 'structural'));
});

describe('aiMapUnavailableReason', () => {
  test.each([
    ['unmetered servers', status({ metered: false }), true, undefined],
    ['a remaining allowance', status({ metered: true, accountingReady: true, limit: 5, remaining: 1 }), true, undefined],
    ['an unlimited plan', status({ metered: true, accountingReady: true, limit: null, remaining: null }), true, undefined],
    ['explicit unlimited overrides a stale counter', status({ unlimited: true, accountingReady: true, limit: 20, remaining: 0 }), true, undefined],
    ['readers', status({ metered: false }), false, 'edit access'],
    ['usage tracking that is not set up', notReady, true, 'administrator'],
    ['a temporary usage outage', status({ accountingReady: false, retryable: true }), true, 'Try again shortly'],
    ['a used allowance', status({ metered: true, accountingReady: true, limit: 5, remaining: 0 }), true, 'no AI responses left'],
  ])('%s', (_case, value, canWrite, text) => {
    const reason = aiMapUnavailableReason(value, canWrite);

    if (text === undefined) expect(reason).toBeUndefined();
    else expect(reason).toContain(text);
  });
});

test('the mind map tab says why AI generation is unavailable', async () => {
  jest.mocked(loadPresentation).mockResolvedValue(loaded(notReady));
  render(<PresentationStudio {...props()} />);

  expect(await screen.findByText(/AI usage tracking is set up on this server/)).toBeTruthy();
  expect(await screen.findByTestId('server-map')).toBeTruthy();
  expect(mockViewerProps?.canGenerate).toBe(false);
});

test('the mind map tab offers generation when the workspace can use AI', async () => {
  jest.mocked(loadPresentation).mockResolvedValue(loaded(available));
  render(<PresentationStudio {...props()} />);

  await screen.findByTestId('server-map');
  expect(mockViewerProps?.canGenerate).toBe(true);
  expect(screen.queryByText(/You can still view saved maps/)).toBeNull();
});

describe('Present AI mind map', () => {
  const present = () => ({ ...props(), presentMindMap: true });

  test('presents the page structure map full screen when no AI map is saved', async () => {
    const onClose = jest.fn();

    jest.mocked(loadPresentation).mockResolvedValue(loaded(notReady));
    render(<PresentationStudio {...present()} onClose={onClose} />);

    const presented = await screen.findByTestId('server-map');

    expect(presented.textContent).toBe('Page structure');
    expect(screen.queryByRole('navigation', { name: 'Page presentation tools' })).toBeNull();
    expect(mockViewerProps?.origin).toBeUndefined();
    expect(screen.queryByText('No saved mind map is selected.')).toBeNull();
    expect(mockRunGeneration).not.toHaveBeenCalled();
    // Closing the presentation returns to the page, as it does for a saved AI map.
    act(() => mockViewerProps?.onClosePresentation?.());
    expect(onClose).toHaveBeenCalled();
  });

  test('presents a saved AI map full screen', async () => {
    jest.mocked(loadPresentation).mockResolvedValue(loaded(available, map('saved', 'Saved AI map', 'ai')));
    render(<PresentationStudio {...present()} />);

    expect((await screen.findByTestId('server-map')).textContent).toBe('Saved AI map');
    expect(mockViewerProps?.origin).toBe('ai');
    expect(mockViewerProps?.onClosePresentation).toBeDefined();
  });

  test('shows one loading state, without the studio page, until the map is presented', async () => {
    let finishLoad!: (value: never) => void;
    let finishStructure!: (value: Artifact<MindMap>) => void;

    jest.mocked(loadPresentation).mockReturnValue(new Promise((resolve) => (finishLoad = resolve)));
    jest.mocked(loadStructuralMap).mockReturnValue(new Promise((resolve) => (finishStructure = resolve)));
    render(<PresentationStudio {...present()} />);

    expect(screen.getByText('Loading mind map…')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Page presentation tools' })).toBeNull();
    // Finding no saved AI map and loading the page structure instead keeps the same message.
    await act(async () => finishLoad(loaded(notReady)));
    expect(screen.getByText('Loading mind map…')).toBeTruthy();
    expect(screen.queryByText('Loading page structure…')).toBeNull();
    await act(async () => finishStructure(map('structure', 'Page structure', 'structural')));
    expect((await screen.findByTestId('server-map')).textContent).toBe('Page structure');
    expect(screen.queryByText('Loading mind map…')).toBeNull();
  });

  test('tells readers without a saved map why no map can be shown', async () => {
    jest.mocked(loadPresentation).mockResolvedValue(loaded(notReady));
    render(<PresentationStudio {...present()} canWrite={false} />);

    const message = await screen.findByText(/Editor access is required to create a map from page structure/);

    expect(message.closest('main')).not.toBeNull();
    expect(screen.getByText('Back to page')).toBeTruthy();
    expect(loadStructuralMap).not.toHaveBeenCalled();
  });
});
