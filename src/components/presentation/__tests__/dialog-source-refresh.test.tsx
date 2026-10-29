import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { setActiveRowPage } from '@/application/row-document/row-page-state';
import { CoverType, type ViewCover } from '@/application/types';

import PresentEntry from '../PresentEntry';
import { cachedSavedDecks, forgetSavedDecks, listCachedSavedDecks } from '../saved-deck-cache';
import { APPFLOWY_SLIDE_THEMES } from '../slide-themes';

import type { SourceEnvelope, Theme } from '../server-contract';

mockResizeObserver();

const mockRequest = jest.fn();
const mockLoadView = jest.fn(async () => ({}));
// The app's operations are stable functions; the dialog's source read depends on them.
const mockOperations = { loadView: mockLoadView, loadRowDocument: jest.fn(), toView: jest.fn(async () => undefined) };
const mockAccess = jest.fn((_enabled?: boolean) => ({ isPro: false, canManageStyles: false, onUpgrade: jest.fn() }));
let mockName = 'Live document';
let mockCover: ViewCover | undefined;
const mockTheme = APPFLOWY_SLIDE_THEMES[0] as Theme;
const mockContent = {
  type: 'page',
  children: [
    {
      type: 'heading',
      blockId: 'heading-live',
      data: { level: 1 },
      children: [{ type: 'text', children: [{ text: 'Real page heading' }] }],
    },
  ],
};

function mockSource(pageId: string): SourceEnvelope {
  return {
    schemaVersion: 1,
    revision: `server-envelope-${pageId}`,
    title: 'Live document',
    sources: [{ pageId, title: 'Live document', kind: 'document', revision: `native-${pageId}`, original: {} }],
    blocks: [
      {
        id: 'heading-live',
        pageId,
        kind: 'heading',
        text: 'Real page heading',
        sourceIds: ['canonical:heading'],
        children: [],
        semantic: { level: 1 },
      },
    ],
    databaseViews: [],
    assets: [],
    dependencyRevisions: [],
    coverage: [],
    references: {},
  };
}

const mockJob = (state: string) => ({
  id: 'job',
  state,
  kind: 'slides',
  sourceRevision: 'server-envelope-document',
  artifactId: null,
  resultVersion: null,
  committedUnits: 0,
  errorReason: null,
});

function mockWire(config: { url: string; method?: string; data?: { sources?: Array<{ pageId: string }> } }) {
  const method = config.method ?? 'GET';
  let data: unknown;

  if (config.url.endsWith('/sources')) data = mockSource(config.data?.sources?.[0].pageId ?? 'document');
  else if (config.url.endsWith('/status'))
    data = {
      schemaVersion: 1,
      promptBundleVersion: 'bundle',
      plan: 'free',
      usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 },
      remainingSlides: 12,
      themes: [mockTheme],
      slideSchemas: [1, 2],
      maxSlides: 100,
      aiResponses: { metered: true, accountingReady: true, committed: 0, reserved: 0, limit: 30, remaining: 30 },
    };
  else if (config.url.endsWith('/session'))
    data =
      method === 'PUT'
        ? { workspaceId: 'workspace', actorId: 'user', revision: 1, payload: {}, updatedAt: '2026-10-28T00:00:00Z' }
        : null;
  else if (config.url.endsWith('/decks') || config.url.endsWith('/styles')) data = { items: [], nextCursor: null };
  else if (config.url.endsWith('/slides/assess'))
    data = {
      sourceRevision: 'server-envelope-document',
      promptBundleVersion: 'bundle',
      coverage: [],
      assessment: {
        condition: 'concise',
        rationale: 'Source evidence',
        recommendations: [{ layout: 'summary', reason: 'Summary' }],
        question: null,
        recommendedThemeId: mockTheme.id,
        recommendedSlideCount: 4,
        similarTemplate: false,
        templateReason: '',
      },
    };
  // The generation keeps running; only a cancellation ends it.
  else if (config.url.endsWith('/generate')) data = mockJob('running');
  else if (config.url.endsWith('/jobs/job')) data = mockJob(method === 'DELETE' ? 'canceled' : 'running');
  else throw new Error(`Unexpected presentation request ${method} ${config.url}`);
  return Promise.resolve({ status: 200, data: { code: 0, data, message: 'OK' }, headers: {} });
}

const requests = (method: string, path: string) =>
  mockRequest.mock.calls.filter(
    ([config]: [{ url: string; method?: string }]) => (config.method ?? 'GET') === method && config.url.endsWith(path)
  ).length;

jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => ({ request: mockRequest }) }));
jest.mock('@/application/session/token', () => ({
  captureTokenSession: () => 'user',
  isTokenSessionCurrent: () => true,
}));
jest.mock('@/components/app/app.hooks', () => ({
  useAppView: (id: string) => ({ view_id: id, name: mockName, extra: { cover: mockCover } }),
  useCurrentWorkspaceId: () => 'workspace',
  useCurrentWorkspaceIdOptional: () => 'workspace',
  useEventEmitterOptional: () => undefined,
  useAppOperations: () => mockOperations,
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: 'user' }) }));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: () => ({ canRead: true, canWrite: true, hasLoadedViewActionPermissions: true }),
}));
jest.mock('../usePresentationAccess', () => ({ usePresentationAccess: (enabled?: boolean) => mockAccess(enabled) }));
jest.mock('@/application/slate-yjs/utils/convert', () => ({ yDocToSlateContent: () => mockContent }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function presentDocument() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  return screen.findByRole('menuitem', { name: 'Present document' }).then((item) => fireEvent.click(item));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function expectAccessWithoutStatus() {
  expect(mockAccess).toHaveBeenCalled();
  expect(mockAccess.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
}

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
  // jsdom has no randomUUID; generation needs one for its request identity.
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => '00000000-0000-4000-8000-000000000001',
  });
});
beforeEach(() => {
  jest.clearAllMocks();
  mockName = 'Live document';
  mockCover = undefined;
  setActiveRowPage(null);
  mockRequest.mockImplementation(mockWire);
  forgetSavedDecks('workspace', 'user');
});

test('a rename keeps an open AI Slides studio and its running generation', async () => {
  const { rerender, unmount } = render(<PresentEntry viewId='document' slidesOnly />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate AI ppt' }));
  const setup = await screen.findByRole('region', { name: 'Create presentation settings' }, { timeout: 5000 });
  const generate = await screen.findByRole('button', { name: 'Generate presentation' });

  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(generate);
  await waitFor(() => expect(requests('POST', '/generate')).toBe(1));
  const reads = { sources: requests('POST', '/sources'), status: requests('GET', '/status') };

  // An outline rename, a cover change and RightMenu's row-title prop all reach the dialog together.
  mockName = 'Renamed document';
  mockCover = { type: CoverType.BuildInImage, value: '3', offset: 0.6 };
  rerender(<PresentEntry viewId='document' title='Renamed row' slidesOnly />);
  await flush();

  expect(screen.getByRole('region', { name: 'Create presentation settings' })).toBe(setup);
  expect(screen.getByRole('button', { name: 'Generating…' })).toBeTruthy();
  expect(requests('DELETE', '/jobs/job')).toBe(0);
  expect(requests('POST', '/sources')).toBe(reads.sources);
  expect(requests('GET', '/status')).toBe(reads.status);
  expectAccessWithoutStatus();
  unmount();
});

test('a rename keeps a document presentation on its slide and shows the new title', async () => {
  const { rerender } = render(<PresentEntry viewId='document' />);

  await presentDocument();
  expect(await screen.findByRole('heading', { name: 'Live document' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
  const slide = screen.getByLabelText('Slide 2 of 2');
  const loads = mockLoadView.mock.calls.length;

  mockName = 'Renamed document';
  rerender(<PresentEntry viewId='document' />);
  await flush();
  expect(screen.getByLabelText('Slide 2 of 2')).toBe(slide);
  fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
  expect(screen.getByRole('heading', { name: 'Renamed document' })).toBeTruthy();

  // RightMenu passes a row page's title as a prop; it takes precedence and is live too.
  rerender(<PresentEntry viewId='document' title='Row title' />);
  await flush();
  expect(screen.getByRole('heading', { name: 'Row title' })).toBeTruthy();
  expect(screen.getByLabelText('Slide 1 of 2')).toBe(slide);
  expect(mockLoadView).toHaveBeenCalledTimes(loads);
  expect(requests('GET', '/status')).toBe(0);
  expectAccessWithoutStatus();
});

test('a cover change shows on the open title slide without reloading the document', async () => {
  const { rerender } = render(<PresentEntry viewId='document' />);

  await presentDocument();
  const slide = await screen.findByLabelText('Slide 1 of 2');
  const loads = mockLoadView.mock.calls.length;

  expect(slide.querySelector('.ps-doc-cover')).toBeNull();
  mockCover = { type: CoverType.BuildInImage, value: '3', offset: 0.6 };
  rerender(<PresentEntry viewId='document' />);
  await flush();
  expect(screen.getByLabelText('Slide 1 of 2')).toBe(slide);
  expect(slide.querySelector('.ps-doc-cover img')?.getAttribute('src')).toBe('/covers/m_cover_image_3.png');
  expect(mockLoadView).toHaveBeenCalledTimes(loads);
});

test('closing an AI dialog drops the cached deck catalog; closing a document presentation keeps it', async () => {
  await listCachedSavedDecks({ workspaceId: 'workspace', pageId: 'document' }, 'user');
  render(<PresentEntry viewId='document' />);

  await presentDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Exit presentation' }));
  await waitFor(() => expect(screen.queryByLabelText('Slide 1 of 2')).toBeNull());
  expect(cachedSavedDecks('workspace', 'user')).toEqual([]);

  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Generate AI ppt' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Close generation settings' }, { timeout: 5000 }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Create presentation settings' })).toBeNull());
  expect(cachedSavedDecks('workspace', 'user')).toBeUndefined();
});
