import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import PresentationStudio from '../PresentationStudio';
import {
  createGenerationRunner,
  exportDeck,
  loadPresentation,
  loadSavedDeck,
  loadSourceSnapshot,
  saveSession,
} from '../presentation-client';
import { regenerationReference } from '../workflow-state';

import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { PageSnapshot, SavedDeck } from '../types';

jest.mock('../server-client', () => ({
  PresentationAPIError: class extends Error {
    constructor(message: string, public code: string, public status: number) {
      super(message);
    }
  },
}));
jest.mock('../presentation-client', () => ({
  PresentationAPIError: jest.requireMock('../server-client').PresentationAPIError,
  createGenerationRunner: jest.fn(),
  loadPresentation: jest.fn(),
  loadSavedDeck: jest.fn(),
  loadSourceSnapshot: jest.fn(),
  loadStructuralMap: jest.fn(),
  editMap: jest.fn(),
  exportDeck: jest.fn(),
  saveSession: jest.fn(),
  serverOptions: jest.fn(() => ({})),
  styleReference: jest.fn(() => undefined),
  uiOptions: jest.fn(),
  themeToStyle: (theme: unknown) => theme,
}));
jest.mock('../SlidesWorkflow', () => ({
  __esModule: true,
  default: (props: SlidesWorkflowProps) => (
    <div>
      <span data-testid='stage'>{props.stage}</span>
      <span data-testid='deck'>
        {props.activeDeck?.id}:{props.activeDeck?.version}
      </span>
      <button disabled={!props.canGenerate} onClick={() => props.onGenerate()}>
        Generate
      </button>
      <button onClick={() => props.onOptions({ ...props.options, reviewOutline: true })}>Review first</button>
      <button onClick={() => props.onStage('story')}>Edit story</button>
      <button onClick={() => props.onPlan({ ...props.plan!, title: 'Edited title' })}>Change story</button>
      <button onClick={() => void props.onApplyOutline()}>Accept story</button>
      <button onClick={() => void props.onDownload?.('export-retry-id', new AbortController().signal)}>Download</button>
      <span data-testid='outline-error'>{props.outlineError?.message}</span>
      <span data-testid='narrative'>{String(props.hasNarrative)}</span>
    </div>
  ),
}));
jest.mock('../DocumentPresenter', () => ({ __esModule: true, default: () => null, BlockContent: () => null }));
jest.mock('../DocumentContentProvider', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../DocumentOutline', () => ({
  DocumentOutlineContext: jest.requireActual<typeof import('react')>('react').createContext({}),
}));
jest.mock('../document-outline', () => ({ documentOutline: () => ({ headings: [] }) }));
jest.mock('../source', () => ({
  flattenBlocks: () => [],
  splitDocument: () => [],
}));
jest.mock('../mindmap-references', () => ({ resolveMapReferences: () => new Map() }));
jest.mock('../MindMapViewer', () => ({ __esModule: true, default: () => null }));
jest.mock('../StyleSettings', () => ({ __esModule: true, default: () => null }));
jest.mock('../ui', () => ({
  Action: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../PresentationPaywall', () => ({
  __esModule: true,
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));
jest.mock('@mui/material/Dialog', () => ({ __esModule: true, default: () => null }));

const source = {
  pageId: 'page',
  title: 'Source',
  revision: 'server-revision',
  kind: 'document',
  blocks: [],
  properties: [],
  warnings: [],
  serverSource: { revision: 'server-revision' },
} as unknown as PageSnapshot;
const style = {
  id: 'trusted-theme',
  name: 'Server theme',
  color: '#000000',
  background: '#ffffff',
  font: 'Arial',
  footer: '',
  guidelines: '',
  description: '',
};
const deck: SavedDeck = {
  id: 'saved-deck',
  version: 1,
  plan: {
    title: 'Saved story',
    slides: [
      {
        id: 'slide',
        title: 'Title',
        message: 'Message',
        points: [],
        layout: 'title',
        sourceIds: ['page'],
        notes: '',
        warnings: [],
      },
    ],
  },
  style,
  sourceRevision: source.revision,
  source,
  createdAt: '2026-10-28',
};
const status = {
  plan: 'free',
  remainingSlides: 12,
  themes: [style],
  usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 },
  aiResponses: { accountingReady: true, limit: 20, remaining: 20 },
};
let run: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(global, 'structuredClone', {
    configurable: true,
    value: (value: unknown) => JSON.parse(JSON.stringify(value)),
  });
  run = jest.fn().mockResolvedValue({ deck, artifact: { id: deck.id, version: 1 }, status });
  (createGenerationRunner as jest.Mock).mockReturnValue(run);
  (loadPresentation as jest.Mock).mockResolvedValue({ status, session: null, decks: [], styles: [] });
  (loadSourceSnapshot as jest.Mock).mockResolvedValue(source);
  (loadSavedDeck as jest.Mock).mockResolvedValue(deck);
  (saveSession as jest.Mock).mockResolvedValue({ revision: 1 });
  (exportDeck as jest.Mock).mockResolvedValue({ blob: new Blob(['pptx']), fileName: 'deck.pptx', status });
});

const open = (initialDeck?: SavedDeck) =>
  render(
    <PresentationStudio workspaceId='workspace' userId='user' snapshot={source} canWrite initialDeck={initialDeck} />
  );

test('generated outline acceptance reuses the durable artifact without another generation or import', async () => {
  open();
  await waitFor(() => expect(loadPresentation).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Review first'));
  await waitFor(() => expect(screen.getByText('Generate').disabled).toBe(false));
  fireEvent.click(screen.getByText('Generate'));
  await waitFor(() => expect(screen.getByTestId('stage').textContent).toBe('outline'));
  expect(screen.getByTestId('deck').textContent).toBe('saved-deck:1');
  fireEvent.click(screen.getByText('Accept story'));
  await waitFor(() => expect(screen.getByTestId('stage').textContent).toBe('preview'));
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0]).toMatchObject({
    task: 'slides',
    scope: { workspaceId: 'workspace', pageId: 'page' },
    source,
    style,
  });
  expect(run.mock.calls[0][0]).not.toHaveProperty('system');
  expect(run.mock.calls[0][0]).not.toHaveProperty('aiUsage');
});

test('edited story binds artifact version and retains previous durable deck after failure', async () => {
  open(deck);
  await waitFor(() => expect(screen.getByText('Generate').disabled).toBe(false));
  fireEvent.click(screen.getByText('Edit story'));
  fireEvent.click(screen.getByText('Change story'));
  run.mockRejectedValueOnce(new Error('Provider unavailable'));
  fireEvent.click(screen.getByText('Accept story'));
  await waitFor(() => expect(screen.getByTestId('outline-error').textContent).toBe('Provider unavailable'));
  expect(screen.getByTestId('deck').textContent).toBe('saved-deck:1');
  expect(run.mock.calls[0][0]).toMatchObject({
    artifact: { id: deck.id, version: 1 },
    storyPlan: { title: 'Edited title' },
    storyPlanSourceRevision: source.revision,
  });
});

test('cancel aborts the active job observer and leaves the saved deck intact', async () => {
  open(deck);
  await waitFor(() => expect(screen.getByText('Generate').disabled).toBe(false));
  run.mockImplementationOnce(
    (_input, signal: AbortSignal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')))
      )
  );
  fireEvent.click(screen.getByText('Generate'));
  await waitFor(() => expect(run).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Cancel'));
  expect(run.mock.calls[0][1].aborted).toBe(true);
  await waitFor(() => expect(screen.getByText('Generate').disabled).toBe(false));
  expect(screen.getByTestId('deck').textContent).toBe('saved-deck:1');
});

test('download references the saved artifact and returns the server binary without regenerating', async () => {
  open(deck);
  await waitFor(() => expect(screen.getByText('Generate').disabled).toBe(false));
  fireEvent.click(screen.getByText('Download'));
  await waitFor(() =>
    expect(exportDeck).toHaveBeenCalledWith(
      { workspaceId: 'workspace', pageId: 'page' },
      { id: deck.id, version: 1 },
      'export-retry-id',
      expect.any(AbortSignal),
      undefined
    )
  );
  expect(run).not.toHaveBeenCalled();
});

test('workspace switch clears saved content while new authority is loading', async () => {
  const view = open(deck);

  await waitFor(() => expect(screen.getByText('Generate').disabled).toBe(false));
  (loadPresentation as jest.Mock).mockReturnValueOnce(new Promise(() => undefined));
  view.rerender(<PresentationStudio workspaceId='other-workspace' userId='user' snapshot={source} canWrite />);
  await waitFor(() => expect(screen.getByTestId('deck').textContent).toBe(':'));
  expect(screen.getByText('Generate').disabled).toBe(true);
});

test('reopened artifact can bind an exact server source hash but foreign or local snapshots cannot', () => {
  expect(regenerationReference({ ...deck, source: undefined }, source)).toEqual({ id: deck.id, version: 1 });
  expect(() => regenerationReference(deck, { ...source, revision: 'other' })).toThrow('original');
  expect(() => regenerationReference(deck, { ...source, serverSource: undefined })).toThrow('original');
  expect(() => regenerationReference({ ...deck, version: undefined }, source)).toThrow('original');
});

test('a late previous-actor response cannot restore private content or stale allowance', async () => {
  let resolvePrevious!: (value: unknown) => void;

  (loadPresentation as jest.Mock).mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePrevious = resolve;
    })
  );
  const view = open();

  (loadPresentation as jest.Mock).mockResolvedValueOnce({
    status: { ...status, remainingSlides: 0 },
    session: null,
    decks: [],
    styles: [],
  });
  view.rerender(<PresentationStudio workspaceId='workspace' userId='different-user' snapshot={source} canWrite />);
  await waitFor(() => expect(loadPresentation).toHaveBeenCalledTimes(2));
  await act(async () => {
    resolvePrevious({ status, session: null, decks: [deck], styles: [] });
  });
  expect((screen.getByText('Generate')).disabled).toBe(true);
  expect(screen.getByTestId('deck').textContent).toBe(':');
});

test.each([
  { mapRevision: source.revision, refreshedRevision: source.revision, included: true },
  { mapRevision: null, refreshedRevision: source.revision, included: false },
  { mapRevision: 'other-page-revision', refreshedRevision: source.revision, included: false },
  { mapRevision: source.revision, refreshedRevision: 'new-source-revision', included: false },
])('restores a saved narrative only for the current source ($mapRevision / $refreshedRevision)', async ({ mapRevision, refreshedRevision, included }) => {
  (loadPresentation as jest.Mock).mockResolvedValueOnce({
    status, session: null, decks: [], styles: [],
    mapArtifact: { id: 'saved-narrative', version: 4, sourceRevision: mapRevision },
  });
  (loadSourceSnapshot as jest.Mock).mockResolvedValueOnce({ ...source, revision: refreshedRevision });
  open();
  await waitFor(() => expect(screen.getByText('Generate').disabled).toBe(false));
  expect(screen.getByTestId('narrative').textContent).toBe(String(mapRevision === source.revision));
  fireEvent.click(screen.getByText('Generate'));
  await waitFor(() => expect(run).toHaveBeenCalled());
  expect(run.mock.calls[0][0].narrative).toEqual(included ? { id: 'saved-narrative', version: 4 } : undefined);
});
