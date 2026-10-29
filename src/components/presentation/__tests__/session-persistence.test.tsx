import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { createGenerationRunner, loadPresentation, loadSourceSnapshot, saveSession } from '../presentation-client';
import PresentationStudio from '../PresentationStudio';
import { serverOptions, themeToStyle } from '../server-adapter';

import type { PresentationSession, StoredSession, Theme } from '../server-contract';
import type { SlidesWorkflowProps } from '../SlidesWorkflow';
import type { GenerationOptions, PageSnapshot, SavedDeck } from '../types';

jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => undefined }));
jest.mock('@/application/session/token', () => ({ captureTokenSession: () => ({}), isTokenSessionCurrent: () => true }));
// Real option and style projections, so a restored session serializes exactly as it would in the app.
jest.mock('../presentation-client', () => ({
  ...jest.requireActual('../server-adapter'),
  PresentationAPIError: jest.requireActual('../server-client').PresentationAPIError,
  createGenerationRunner: jest.fn(),
  loadPresentation: jest.fn(),
  loadSavedDeck: jest.fn(),
  loadSourceSnapshot: jest.fn(),
  loadStructuralMap: jest.fn(),
  editMap: jest.fn(),
  exportDeck: jest.fn(),
  saveSession: jest.fn(),
}));
jest.mock('../SlidesWorkflow', () => ({
  __esModule: true,
  default: (props: SlidesWorkflowProps) => (
    <div>
      <span data-testid='style'>{props.style.id}</span>
      <button disabled={!props.canGenerate} onClick={() => props.onGenerate()}>
        Generate
      </button>
      <button onClick={() => props.onOptions({ ...props.options, allowWebSearch: true })}>Allow web search</button>
      <button
        onClick={() => {
          props.onOptions({ ...props.options, designMode: 'auto' });
          props.onStyle(themeToStyle(themes[0]));
        }}
      >
        Switch design mode and theme
      </button>
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
jest.mock('../source', () => ({ flattenBlocks: () => [], splitDocument: () => [] }));
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

const theme = (id: string): Theme => ({
  id,
  name: id,
  description: '',
  color: '#112233',
  background: '#ffffff',
  textColor: '#112233',
  font: 'Arial',
  bodyFont: 'Arial',
  footer: '',
  palette: [],
  guidelines: '',
});
const themes = [theme('first'), theme('chosen')];
const status = {
  plan: 'paid',
  promptBundleVersion: 'bundle',
  remainingSlides: 20,
  maxSlides: 20,
  themes,
  usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 },
  aiResponses: { accountingReady: true, limit: null, remaining: null },
};
const source = {
  pageId: 'page',
  title: 'Source',
  revision: 'revision',
  kind: 'document',
  blocks: [],
  properties: [],
  warnings: [],
  serverSource: { revision: 'revision' },
} as unknown as PageSnapshot;
const options: GenerationOptions = {
  designMode: 'theme',
  audience: '',
  slideCount: 6,
  slideCountMode: 'fixed',
  slideCountSelection: 'preset',
  instructions: '',
  includeProperties: true,
  allowWebSearch: false,
};

function stored(themeId: string): StoredSession {
  const payload: PresentationSession = {
    artifact: null,
    narrative: null,
    // A built-in theme has no style reference; its identity is in the options.
    style: null,
    options: serverOptions(options, themeToStyle(theme(themeId))),
    mapStyle: { structure: 'right-facing', branchLine: 'rounded' },
  };

  return { workspaceId: 'workspace', actorId: 'user', revision: 3, updatedAt: '', payload };
}

const open = () => render(<PresentationStudio workspaceId='workspace' userId='user' snapshot={source} canWrite />);
// Renders scheduled inside an async act wait for it to end, so settle them before moving the clock;
// otherwise a debounce scheduled by the load would only start after the time it should have fired in.
const advance = async (ms: number) => {
  await act(async () => undefined);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(loadSourceSnapshot).mockResolvedValue(source);
  jest
    .mocked(saveSession)
    .mockImplementation(async (_scope, revision, payload) => ({ ...stored('first'), revision: revision + 1, payload }));
});
afterEach(() => jest.useRealTimers());

test('reopening restores the saved built-in theme and writes nothing back', async () => {
  jest
    .mocked(loadPresentation)
    .mockResolvedValue({ status, session: stored('chosen'), styles: [], warnings: [] } as never);
  open();
  await advance(2000);
  expect(screen.getByTestId('style').textContent).toBe('chosen');
  expect(saveSession).not.toHaveBeenCalled();
});

test('a changed preference is written once', async () => {
  jest
    .mocked(loadPresentation)
    .mockResolvedValue({ status, session: stored('chosen'), styles: [], warnings: [] } as never);
  open();
  await advance(2000);
  fireEvent.click(screen.getByText('Allow web search'));
  await advance(2000);
  expect(saveSession).toHaveBeenCalledTimes(1);
  expect(jest.mocked(saveSession).mock.calls[0][1]).toBe(3);
  expect(jest.mocked(saveSession).mock.calls[0][2].options).toMatchObject({ allowWebSearch: true, themeId: 'chosen' });
});

test('opening a generated deck saves its own style and options in a single write', async () => {
  const deckOptions: GenerationOptions = { ...options, slideCount: 4, slideCountSelection: 'custom' };
  const deck: SavedDeck = {
    id: 'deck',
    version: 2,
    plan: { title: 'Deck', slides: [] },
    style: themeToStyle(themes[1]),
    sourceRevision: source.revision,
    createdAt: '',
    options: deckOptions,
  };
  const run = jest.fn().mockResolvedValue({ deck, artifact: { id: deck.id, version: deck.version }, status });

  jest.mocked(createGenerationRunner).mockReturnValue(run);
  jest
    .mocked(loadPresentation)
    .mockResolvedValue({ status, session: stored('first'), styles: [], warnings: [] } as never);
  open();
  await advance(2000);
  expect(screen.getByTestId('style').textContent).toBe('first');
  fireEvent.click(screen.getByText('Generate'));
  await advance(2000);
  expect(run).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('style').textContent).toBe('chosen');
  expect(saveSession).toHaveBeenCalledTimes(1);
  expect(jest.mocked(saveSession).mock.calls[0][2]).toMatchObject({
    artifact: { id: deck.id, version: deck.version },
    options: { themeId: 'chosen', slideCount: 4, slideCountMode: 'custom' },
  });
});

test('a single design selection saves both its mode and theme before the next render', async () => {
  jest
    .mocked(loadPresentation)
    .mockResolvedValue({ status, session: stored('chosen'), styles: [], warnings: [] } as never);
  open();
  await advance(2000);
  fireEvent.click(screen.getByText('Switch design mode and theme'));
  await advance(2000);
  expect(saveSession).toHaveBeenCalledTimes(1);
  expect(jest.mocked(saveSession).mock.calls[0][2].options).toMatchObject({ design: 'auto', themeId: 'first' });
});

test('opening and editing preferences preserves a saved deck, stale narrative and custom map style', async () => {
  const saved = stored('chosen');

  saved.payload.artifact = { id: 'saved-deck', version: 4 };
  saved.payload.narrative = { id: 'saved-map', version: 2 };
  saved.payload.mapStyle = { structure: 'top-down', branchLine: 'curved' };
  jest.mocked(loadPresentation).mockResolvedValue({
    status,
    session: saved,
    styles: [],
    warnings: [],
    mapArtifact: { id: 'saved-map', version: 2, sourceRevision: 'old-revision' },
  } as never);
  open();
  await advance(2000);
  expect(saveSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Allow web search'));
  await advance(2000);
  expect(saveSession).toHaveBeenCalledTimes(1);
  expect(jest.mocked(saveSession).mock.calls[0][2]).toEqual({
    ...saved.payload,
    options: { ...saved.payload.options, allowWebSearch: true },
  });
});
