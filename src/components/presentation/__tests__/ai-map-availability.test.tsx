import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import { aiMapUnavailableReason } from '../ai-map-availability';
import PresentationStudio from '../PresentationStudio';
import { createGenerationRunner, loadPresentation, loadSourceSnapshot, loadStructuralMap, openReusableGeneration, saveSession, serverOptions } from '../presentation-client';

import { useReusableGeneration } from '../useReusableGeneration';

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
let mockReuse: ReturnType<typeof useReusableGeneration>;

jest.mock('../useReusableGeneration', () => ({ useReusableGeneration: () => mockReuse }));

jest.mock('../presentation-client', () => ({
  PresentationAPIError: class extends Error {},
  createGenerationRunner: jest.fn(),
  loadPresentation: jest.fn(),
  loadStructuralMap: jest.fn(),
  loadSourceSnapshot: jest.fn(),
  openReusableGeneration: jest.fn(),
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
  mockReuse = { job: undefined, checking: false, error: undefined, refresh: jest.fn() };
  jest.mocked(loadSourceSnapshot).mockResolvedValue(source());
  jest.mocked(serverOptions).mockReturnValue({} as never);
  const artifact = map('generated', 'AI generated map', 'ai');

  mockRunGeneration.mockResolvedValue({ map: artifact.content, artifact, status: available });
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

  expect((await screen.findAllByText(/AI usage tracking is set up on this server/)).length).toBeGreaterThan(0);
  expect(screen.queryByTestId('server-map')).toBeNull();
  expect(loadStructuralMap).not.toHaveBeenCalled();
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test('the mind map tab automatically generates with AI when no saved result exists', async () => {
  jest.mocked(loadPresentation).mockResolvedValue(loaded(available));
  render(<PresentationStudio {...props()} />);

  await screen.findByTestId('server-map');
  expect(mockViewerProps?.origin).toBe('ai');
  expect(mockRunGeneration).toHaveBeenCalledTimes(1);
  expect(loadStructuralMap).not.toHaveBeenCalled();
  expect(screen.queryByText(/You can still view saved maps/)).toBeNull();
});

describe('Present AI mind map', () => {
  const present = () => ({ ...props(), presentMindMap: true });

  test('generates and presents an AI map by default when no AI map is saved', async () => {
    const onClose = jest.fn();

    jest.mocked(loadPresentation).mockResolvedValue(loaded(available));
    render(<PresentationStudio {...present()} onClose={onClose} />);
    expect((await screen.findByTestId('server-map')).textContent).toBe('AI generated map');
    expect(screen.queryByRole('navigation', { name: 'Page presentation tools' })).toBeNull();
    expect(mockViewerProps?.origin).toBe('ai');
    expect(mockRunGeneration).toHaveBeenCalledTimes(1);
    expect(loadStructuralMap).not.toHaveBeenCalled();
    act(() => mockViewerProps?.onClosePresentation?.());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('presents a saved AI map full screen', async () => {
    jest.mocked(loadPresentation).mockResolvedValue(loaded(available, map('saved', 'Saved AI map', 'ai')));
    render(<PresentationStudio {...present()} />);

    expect((await screen.findByTestId('server-map')).textContent).toBe('Saved AI map');
    expect(mockViewerProps?.origin).toBe('ai');
    expect(mockViewerProps?.onClosePresentation).toBeDefined();
  });

  test('keeps one loading surface through saved lookup and AI generation', async () => {
    let finishLoad!: (value: never) => void;
    let finishGeneration!: (value: unknown) => void;

    jest.mocked(loadPresentation).mockReturnValue(new Promise((resolve) => (finishLoad = resolve)));
    mockRunGeneration.mockReturnValue(new Promise((resolve) => (finishGeneration = resolve)));
    render(<PresentationStudio {...present()} />);
    expect(screen.getByText('Loading mind map…')).toBeTruthy();
    await act(async () => finishLoad(loaded(available)));
    expect(screen.getByText('Loading mind map…')).toBeTruthy();
    const artifact = map('generated', 'AI generated map', 'ai');

    await act(async () => finishGeneration({ map: artifact.content, artifact, status: available }));
    expect((await screen.findByTestId('server-map')).textContent).toBe('AI generated map');
    expect(screen.queryByText('Loading mind map…')).toBeNull();
    expect(mockRunGeneration).toHaveBeenCalledTimes(1);
  });

  test('tells readers without a saved map why no map can be shown', async () => {
    jest.mocked(loadPresentation).mockResolvedValue(loaded(notReady));
    render(<PresentationStudio {...present()} canWrite={false} />);

    const message = await screen.findByText(/You need edit access to this page/);

    expect(message.closest('main')).not.toBeNull();
    expect(screen.getByText('Back to page')).toBeTruthy();
    expect(loadStructuralMap).not.toHaveBeenCalled();
  });
});


test('a saved structural map does not replace default AI generation', async () => {
  jest.mocked(loadPresentation).mockResolvedValue(loaded(available, map('structure', 'Old page structure', 'structural')));
  render(<PresentationStudio {...props()} presentMindMap />);
  expect((await screen.findByTestId('server-map')).textContent).toBe('AI generated map');
  expect(mockRunGeneration).toHaveBeenCalledTimes(1);
  expect(loadStructuralMap).not.toHaveBeenCalled();
});

test('a failed automatic generation waits for an explicit retry', async () => {
  jest.mocked(loadPresentation).mockResolvedValue(loaded(available));
  mockRunGeneration.mockRejectedValueOnce(new Error('The AI provider is unavailable'));
  const view = render(<PresentationStudio {...props()} presentMindMap />);

  await screen.findByRole('button', { name: 'Retry AI mind map' });
  view.rerender(<PresentationStudio {...props()} presentMindMap />);
  await act(async () => undefined);
  expect(mockRunGeneration).toHaveBeenCalledTimes(1);
  expect(loadStructuralMap).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry AI mind map' }));
  expect((await screen.findByTestId('server-map')).textContent).toBe('AI generated map');
  expect(mockRunGeneration).toHaveBeenCalledTimes(2);
});

test('read-only reuse still opens an existing AI result when the generation allowance is exhausted', async () => {
  const exhausted = status({ metered: true, accountingReady: true, limit: 5, remaining: 0 });
  const artifact = map('reused', 'Previously generated map', 'ai');

  mockReuse.job = { id: 'old-job' } as never;
  jest.mocked(loadPresentation).mockResolvedValue(loaded(exhausted));
  jest.mocked(openReusableGeneration).mockResolvedValue({ map: artifact.content, artifact, status: exhausted } as never);
  render(<PresentationStudio {...props()} presentMindMap />);
  expect((await screen.findByTestId('server-map')).textContent).toBe('Previously generated map');
  expect(openReusableGeneration).toHaveBeenCalledTimes(1);
  expect(mockRunGeneration).not.toHaveBeenCalled();
});

test('rerenders and a refreshed source revision do not submit a second automatic generation', async () => {
  jest.mocked(loadPresentation).mockResolvedValue(loaded(available));
  jest.mocked(loadSourceSnapshot).mockResolvedValue({ ...source(), revision: 'resolved-revision' });
  const view = render(<PresentationStudio {...props()} presentMindMap />);

  await screen.findByTestId('server-map');
  view.rerender(<PresentationStudio {...props()} presentMindMap />);
  await waitFor(() => expect(mockRunGeneration).toHaveBeenCalledTimes(1));
  expect(loadStructuralMap).not.toHaveBeenCalled();
});

test.each(['generate', 'reuse'] as const)('%s completion preserves a later page-structure selection', async (request) => {
  let finish!: (result: never) => void;
  const pending = new Promise<never>((resolve) => { finish = resolve; });
  const artifact = map('generated', 'AI generated map', 'ai');

  jest.mocked(loadPresentation).mockResolvedValue(loaded(available));
  if (request === 'reuse') {
    mockReuse.job = { id: 'old-job' } as never;
    jest.mocked(openReusableGeneration).mockReturnValue(pending);
  } else mockRunGeneration.mockReturnValue(pending);
  render(<PresentationStudio {...props()} />);
  await waitFor(() => expect(request === 'reuse' ? openReusableGeneration : mockRunGeneration).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'From page structure' }));
  expect((await screen.findByTestId('server-map')).textContent).toBe('Page structure');
  await act(async () => finish({ map: artifact.content, artifact, status: available } as never));

  expect(screen.getByRole('button', { name: 'From page structure' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByTestId('server-map').textContent).toBe('Page structure');
  expect(saveSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'AI mind map' }));
  expect(screen.getByTestId('server-map').textContent).toBe('AI generated map');
  expect(request === 'reuse' ? openReusableGeneration : mockRunGeneration).toHaveBeenCalledTimes(1);
});

test('automatic AI generation does not navigate away from a later Source selection', async () => {
  let finish!: (result: unknown) => void;
  const artifact = map('generated', 'AI generated map', 'ai');

  jest.mocked(loadPresentation).mockResolvedValue(loaded(available));
  mockRunGeneration.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<PresentationStudio {...props()} />);
  await waitFor(() => expect(mockRunGeneration).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  await act(async () => finish({ map: artifact.content, artifact, status: available }));
  expect(screen.getByRole('button', { name: 'Source', exact: true }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByTestId('server-map')).toBeNull();
  expect(saveSession).not.toHaveBeenCalled();
});
