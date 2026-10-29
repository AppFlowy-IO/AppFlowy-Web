import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import {
  createGenerationRunner,
  loadPresentation,
  loadSavedDeck,
  loadSourceSnapshot,
  saveSession,
} from '../presentation-client';
import PresentationStudio from '../PresentationStudio';
import { flattenBlocks } from '../source';
import { hasStoryPlanChanges } from '../story-plan';

import type { JobStatus } from '../server-contract';
import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { PageSnapshot, SavedDeck } from '../types';

let mockWorkflowRenders = 0;
const mockStageReports: Array<[string, unknown]> = [];
const mockSetupChange = jest.fn();

jest.mock('../server-client', () => ({ PresentationAPIError: class extends Error {} }));
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
jest.mock('../SlidesWorkflow', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');

  return {
    __esModule: true,
    default: function MockWorkflow(props: SlidesWorkflowProps) {
      mockWorkflowRenders++;
      // A child's passive effects run after every layout effect and before its parent's passive effects.
      useEffect(() => {
        mockStageReports.push([props.stage, mockSetupChange.mock.calls.at(-1)?.[0]]);
      }, [props.stage]);
      return (
        <div>
          <span data-testid='deck-title'>{props.plan?.title}</span>
          <span data-testid='stage'>{props.stage}</span>
          <button onClick={() => props.onStage('setup')}>Regenerate</button>
          <button disabled={!props.canGenerate} onClick={() => props.onGenerate()}>
            Generate
          </button>
          <button onClick={() => props.onOptions({ ...props.options, allowWebSearch: !props.options.allowWebSearch })}>
            Toggle web search
          </button>
          <button onClick={() => props.onStage('story')}>Edit story</button>
          <button onClick={props.onCancel}>Cancel setup</button>
          <button onClick={() => props.onPlan((plan) => ({ ...plan, title: 'Edited title' }))}>Change story</button>
          <span data-testid='outline-changed'>{String(props.hasOutlineChanges)}</span>
        </div>
      );
    },
  };
});
jest.mock('../source', () => ({ flattenBlocks: jest.fn(() => []), splitDocument: () => [] }));
jest.mock('../story-plan', () => {
  const actual = jest.requireActual('../story-plan');

  return { ...actual, hasStoryPlanChanges: jest.fn(actual.hasStoryPlanChanges) };
});
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
jest.mock('../MindMapViewer', () => ({ __esModule: true, default: () => null }));
jest.mock('../StyleSettings', () => ({ __esModule: true, default: () => null }));
jest.mock('../ui', () => ({
  Action: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../PresentationPaywall', () => ({ __esModule: true, default: () => null }));
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
  id: 'theme',
  name: 'Theme',
  color: '#000000',
  background: '#ffffff',
  font: 'Arial',
  footer: '',
  guidelines: '',
  description: '',
};
const deck: SavedDeck = {
  id: 'deck',
  version: 1,
  plan: {
    title: 'Story',
    slides: [
      { id: 'slide', title: 'Title', message: '', points: [], layout: 'title', sourceIds: [], notes: '', warnings: [] },
    ],
  },
  style,
  sourceRevision: source.revision,
  source,
  createdAt: '',
};
const status = {
  plan: 'paid',
  remainingSlides: 12,
  themes: [style],
  usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 },
  aiResponses: { accountingReady: true, limit: 20, remaining: 20 },
};
const run = jest.fn();
const generateButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Generate' });
const open = (initialDeck?: SavedDeck) =>
  render(
    <PresentationStudio
      workspaceId='workspace'
      userId='user'
      snapshot={source}
      canWrite
      initialDeck={initialDeck}
      onSource={jest.fn()}
      onSetupChange={mockSetupChange}
    />
  );

beforeEach(() => {
  jest.clearAllMocks();
  run.mockReset();
  mockWorkflowRenders = 0;
  mockStageReports.length = 0;
  Object.defineProperty(global, 'structuredClone', {
    configurable: true,
    value: (value: unknown) => JSON.parse(JSON.stringify(value)),
  });
  jest.mocked(createGenerationRunner).mockReturnValue(run);
  jest.mocked(loadPresentation).mockResolvedValue({ status, session: null, styles: [], warnings: [] } as never);
  jest.mocked(loadSourceSnapshot).mockResolvedValue(source);
  jest.mocked(loadSavedDeck).mockResolvedValue(deck);
  jest.mocked(saveSession).mockResolvedValue({ revision: 1 } as never);
});

test('job polls that repeat the shown state do not render the studio again', async () => {
  let report!: (job: JobStatus) => void;
  const job: JobStatus = {
    id: 'job',
    state: 'running',
    kind: 'slides',
    sourceRevision: source.revision,
    artifactId: null,
    resultVersion: null,
    committedUnits: 0,
    errorReason: null,
  };

  run.mockImplementation((_input, _signal, onJob: (job: JobStatus) => void) => {
    report = onJob;
    return new Promise(() => undefined);
  });
  open();
  await waitFor(() => expect(generateButton().disabled).toBe(false));
  fireEvent.click(screen.getByText('Edit story'));
  fireEvent.click(generateButton());
  await waitFor(() => expect(run).toHaveBeenCalled());
  act(() => report(job));
  expect(screen.getByText(/Presentation running/)).toBeTruthy();
  const renders = mockWorkflowRenders;

  act(() => report({ ...job, committedUnits: 2 }));
  act(() => report({ ...job }));
  expect(mockWorkflowRenders).toBe(renders);
  act(() => report({ ...job, state: 'validating' }));
  expect(screen.getByText(/Presentation validating/)).toBeTruthy();
  expect(mockWorkflowRenders).toBe(renders + 1);
});

test('setup uses its footer progress and can cancel without a duplicate banner', async () => {
  run.mockImplementation(() => new Promise(() => undefined));
  open();
  await waitFor(() => expect(generateButton().disabled).toBe(false));
  fireEvent.click(generateButton());
  await waitFor(() => expect(run).toHaveBeenCalled());
  expect(screen.queryByText('Preparing your presentation…')).toBeNull();
  const signal = run.mock.calls[0][1] as AbortSignal;

  fireEvent.click(screen.getByText('Cancel setup'));
  expect(signal.aborted).toBe(true);
});

test('source content is not looked up while no source dialog is open', async () => {
  open();
  await waitFor(() => expect(generateButton().disabled).toBe(false));
  fireEvent.click(screen.getByText('Toggle web search'));
  fireEvent.click(screen.getByText('Toggle web search'));
  expect(mockWorkflowRenders).toBeGreaterThan(2);
  expect(flattenBlocks).not.toHaveBeenCalled();
});

test('story plans are compared when the draft changes, not on unrelated renders', async () => {
  open(deck);
  await waitFor(() => expect(generateButton().disabled).toBe(false));
  fireEvent.click(screen.getByText('Edit story'));
  expect(screen.getByTestId('outline-changed').textContent).toBe('false');
  const comparisons = jest.mocked(hasStoryPlanChanges).mock.calls.length;

  fireEvent.click(screen.getByText('Toggle web search'));
  expect(hasStoryPlanChanges).toHaveBeenCalledTimes(comparisons);
  // An updater edits the latest draft.
  fireEvent.click(screen.getByText('Change story'));
  expect(screen.getByTestId('outline-changed').textContent).toBe('true');
  expect(hasStoryPlanChanges).toHaveBeenCalledTimes(comparisons + 1);
});

test('the setup stage reaches the dialog before any stage paints', async () => {
  open();
  await waitFor(() => expect(generateButton().disabled).toBe(false));
  fireEvent.click(screen.getByText('Edit story'));
  expect(mockStageReports).toEqual([
    ['setup', true],
    ['story', false],
  ]);
});

test('a deck supplied by Share displays while studio metadata is pending without fetching it again', () => {
  jest.mocked(loadPresentation).mockReturnValue(new Promise(() => undefined));
  open(deck);
  expect(screen.getByTestId('deck-title').textContent).toBe('Story');
  expect(screen.getByTestId('stage').textContent).toBe('preview');
  expect(loadSavedDeck).not.toHaveBeenCalled();
  expect(loadSourceSnapshot).not.toHaveBeenCalled();
  expect(saveSession).not.toHaveBeenCalled();
});

test('page entry opens its saved deck, and Regenerate alone opens source preparation and settings', async () => {
  jest.mocked(loadPresentation).mockResolvedValue({ status, session: null, styles: [], warnings: [], deck } as never);
  open();
  await waitFor(() => expect(screen.getByTestId('stage').textContent).toBe('preview'));
  expect(screen.getByTestId('deck-title').textContent).toBe('Story');
  expect(loadSourceSnapshot).not.toHaveBeenCalled();
  expect(saveSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Regenerate'));
  await waitFor(() => expect(loadSourceSnapshot).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('stage').textContent).toBe('setup');
});

test('regenerating a changed page starts a new deck rather than overwriting an incompatible version', async () => {
  const changed = { ...source, revision: 'changed', serverSource: { ...source.serverSource!, revision: 'changed' } };

  jest.mocked(loadSourceSnapshot).mockResolvedValue(changed);
  run.mockResolvedValue({ deck: { ...deck, id: 'new-deck', sourceRevision: 'changed' }, status });
  open(deck);
  await waitFor(() => expect(loadPresentation).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Regenerate'));
  await waitFor(() => expect(generateButton().disabled).toBe(false));
  fireEvent.click(generateButton());
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(run.mock.calls[0][0]).not.toHaveProperty('artifact');
  expect(run.mock.calls[0][0].source.revision).toBe('changed');
});

test('a failed saved-deck lookup stops loading and can be retried', async () => {
  jest.mocked(loadPresentation).mockRejectedValueOnce(new Error('INVALID_QUERY'));
  open();
  await screen.findByRole('alert');
  expect(screen.queryByText('Loading saved presentation…')).toBeNull();
  expect(screen.queryByText('INVALID_QUERY')).toBeNull();
  jest.mocked(loadPresentation).mockResolvedValue({ status, session: null, styles: [], warnings: [], deck } as never);
  fireEvent.click(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByTestId('stage').textContent).toBe('preview'));
});

test('a failed saved-map lookup stops the full-screen spinner and offers retry', async () => {
  jest.mocked(loadPresentation).mockRejectedValueOnce(new Error('INVALID_QUERY'));
  render(
    <PresentationStudio
      workspaceId='workspace'
      userId='user'
      snapshot={source}
      initialMode='mindmap'
      presentMindMap
      canWrite
    />
  );
  await screen.findByRole('alert');
  expect(screen.queryByText('Loading saved mind map…')).toBeNull();
  expect(screen.queryByText('INVALID_QUERY')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Back to page' })).toBeTruthy();
});
