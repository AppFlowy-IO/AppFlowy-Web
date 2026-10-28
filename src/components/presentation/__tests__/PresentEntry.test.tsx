import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { mockResizeObserver } from '@/__mocks__/resizeObserver';
import { setActiveRowPage } from '@/application/row-document/row-page-state';
import { CoverType, type ViewCover } from '@/application/types';
import ShareButton from '@/components/app/share/ShareButton';

import PresentEntry from '../PresentEntry';
import { serverOptions } from '../server-adapter';
import { APPFLOWY_SLIDE_THEMES } from '../slide-themes';
import type { Artifact, SourceEnvelope, StoredSession, Theme } from '../server-contract';
import type { MindMap } from '../types';

mockResizeObserver();

const mockLoadView = jest.fn(async () => ({}));
const mockLoadRowDocument = jest.fn(async () => ({}));
const mockUpgrade = jest.fn();
const mockRequest = jest.fn();
let mockUserId = 'user';
let mockSavedMap: Artifact<MindMap> | undefined;
let mockSession: StoredSession | null = null;
const mockTheme = APPFLOWY_SLIDE_THEMES[0] as Theme;
function mockSource(pageId = 'document'): SourceEnvelope {
  return {
    schemaVersion: 1, revision: `server-envelope-${pageId}`, title: 'Live document',
    sources: [{ pageId, title: 'Live document', kind: 'document', revision: `native-${pageId}`, original: {} }],
    blocks: [
      { id: 'heading-live', pageId, kind: 'heading', text: 'Real page heading', sourceIds: ['canonical:heading'], children: [], semantic: { level: 1 } },
      { id: 'body-live', pageId, kind: 'paragraph', text: 'Actual source content', sourceIds: ['canonical:body'], children: [], semantic: {} },
    ], databaseViews: [], assets: [], dependencyRevisions: [], coverage: [],
    references: Object.fromEntries([['canonical:page', null], ['canonical:heading', 'heading-live'], ['canonical:body', 'body-live']].map(([id, blockId]) => [id!, {
      location: { kind: 'document', pageId, revision: `native-${pageId}`, blockId, propertyId: null }, evidenceKind: 'original', numeric: null,
    }])),
  };
}
function savedMap(map: MindMap, sourceRevision = 'server-envelope-document') {
  mockSavedMap = { id: 'saved-map', workspaceId: 'workspace', version: 2, content: map, sourceRevision,
    origin: 'imported', resultHash: 'validated-map-hash', generationJobId: null, createdAt: '2026-10-28T00:00:00Z',
    mapStyle: { structure: 'right-facing', branchLine: 'rounded' }, promptBundleVersion: null, compiledPromptChecksum: null, providerModel: null };
  mockSession = { workspaceId: 'workspace', actorId: 'user', revision: 1, updatedAt: '2026-10-28T00:00:00Z', payload: {
    artifact: null, narrative: { id: 'saved-map', version: 2 }, style: null, options: serverOptions(), mapStyle: { structure: 'right-facing', branchLine: 'rounded' },
  } };
}
function mockWire(config: { url: string; method?: string; data?: any }) {
  let data: unknown;
  if (config.url.endsWith('/sources')) data = mockSource(config.data.sources[0].pageId);
  else if (config.url.endsWith('/status')) data = { schemaVersion: 1, promptBundleVersion: 'bundle', plan: 'free',
    usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 }, remainingSlides: 12, themes: [mockTheme], slideSchemas: [1, 2], maxSlides: 100,
    aiResponses: { metered: true, accountingReady: true, committed: 0, reserved: 0, limit: 30, remaining: 30 } };
  else if (config.url.endsWith('/session')) data = config.method === 'PUT'
    ? { workspaceId: 'workspace', actorId: mockUserId, revision: (mockSession?.revision ?? 0) + 1, payload: config.data.session, updatedAt: '2026-10-28T00:00:00Z' } : mockSession;
  else if (config.url.endsWith('/decks') || config.url.endsWith('/styles')) data = { items: [], nextCursor: null };
  else if (config.url.endsWith('/artifacts/saved-map')) data = mockSavedMap;
  else if (config.url.endsWith('/map/structure')) data = { id: 'structural-map', workspaceId: 'workspace', version: 1, sourceRevision: 'server-envelope-document', origin: 'structural',
    content: { schemaVersion: 1, nodes: [{ id: 'root', parentId: null, label: 'Live document', summary: '', sourceIds: ['canonical:page'] }], warnings: [] }, mapStyle: { structure: 'right-facing', branchLine: 'rounded' } };
  else if (config.url.endsWith('/slides/assess')) data = { sourceRevision: 'server-envelope-document', promptBundleVersion: 'bundle', coverage: [],
    assessment: { condition: 'concise', rationale: 'Source evidence', recommendations: [{ layout: 'summary', reason: 'Summary' }], question: null, recommendedThemeId: mockTheme.id, recommendedSlideCount: 4, similarTemplate: false, templateReason: '' } };
  else throw new Error(`Unexpected presentation request ${config.method ?? 'GET'} ${config.url}`);
  return Promise.resolve({ status: 200, data: { code: 0, data, message: 'OK' }, headers: {} });
}

jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => ({ request: mockRequest }) }));
jest.mock('@/application/session/token', () => ({ captureTokenSession: () => mockUserId, isTokenSessionCurrent: (actor: string) => actor === mockUserId }));
const mockToView = jest.fn(async () => undefined);
let mockCover: ViewCover | undefined;
const mockPermissions = { canRead: true, canWrite: true, hasLoadedViewActionPermissions: true };
const mockPermissionHook = jest.fn((..._args: unknown[]) => mockPermissions);
const mockContent = {
  type: 'page',
  children: [
    {
      type: 'heading',
      blockId: 'heading-live',
      data: { level: 1 },
      children: [{ type: 'text', children: [{ text: 'Real page heading' }] }],
    },
    {
      type: 'paragraph',
      blockId: 'body-live',
      children: [{ type: 'text', children: [{ text: 'Actual source content' }] }],
    },
  ],
};

jest.mock('@/components/app/app.hooks', () => ({
  useAppView: (id: string) => ({
    view_id: id,
    name: 'Live document',
    extra: { cover: id === 'document' ? mockCover : undefined },
  }),
  useCurrentWorkspaceId: () => 'workspace',
  useCurrentWorkspaceIdOptional: () => 'workspace',
  useEventEmitterOptional: () => undefined,
  useAppOperations: () => ({ loadView: mockLoadView, loadRowDocument: mockLoadRowDocument, toView: mockToView }),
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => ({ uid: mockUserId }) }));
jest.mock('@/components/app/view-actions/useViewActionPermissions', () => ({
  useViewActionPermissions: (...args: unknown[]) => mockPermissionHook(...args),
}));
jest.mock('../usePresentationAccess', () => ({
  usePresentationAccess: () => ({ isPro: false, canManageStyles: false, onUpgrade: mockUpgrade }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/publish-manage', () => ({ PublishManage: () => null }));
jest.mock('@/components/app/share/ShareTabs', () => ({
  __esModule: true,
  default: ({ onPresentationRequest }: { onPresentationRequest: () => void }) => (
    <button onClick={() => onPresentationRequest()}>Create shared deck</button>
  ),
}));
jest.mock('@/application/slate-yjs/utils/convert', () => ({ yDocToSlateContent: () => mockContent }));

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});
beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions.canRead = true;
  mockPermissions.canWrite = true;
  mockCover = undefined;
  setActiveRowPage(null);
  mockUserId = 'user';
  mockSession = null;
  mockSavedMap = undefined;
  mockRequest.mockImplementation(mockWire);
});

it('opens compact AI ppt settings on the authorized page and closes back to the page', async () => {
  render(<PresentEntry viewId='document' slidesOnly />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate AI ppt' }));
  await screen.findByRole('region', { name: 'Create presentation settings' }, { timeout: 5000 });
  expect(mockLoadView).not.toHaveBeenCalled();
  expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/presentation/workspace/sources', method: 'POST', data: expect.objectContaining({ sources: [{ pageId: 'document' }] }) }));
  expect(screen.queryByLabelText('Test scenario')).toBeNull();
  expect(screen.queryByText('Q3 Product Review')).toBeNull();
  expect(screen.getByText('Live document')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Custom', exact: true }), { key: 'Enter' });
  expect(mockUpgrade).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('menuitemradio', { name: '5', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Close generation settings' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Create presentation settings' })).toBeNull());
});

it('does not load source data after access is denied', async () => {
  mockPermissions.canRead = false;
  render(<PresentEntry viewId='document' slidesOnly />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate AI ppt' }));
  expect(await screen.findByText('You no longer have access to this source page.')).toBeTruthy();
  expect(mockLoadView).not.toHaveBeenCalled();
  expect(mockRequest).not.toHaveBeenCalled();
});

it('opens Present document from the page menu and exits directly back to the page', async () => {
  render(<PresentEntry viewId='document' />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present document' }));
  expect(await screen.findByLabelText('Slide 1 of 2')).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'Page presentation tools' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Exit presentation' }));
  await waitFor(() => expect(screen.queryByLabelText('Slide 1 of 2')).toBeNull());
  expect(await screen.findByRole('button', { name: 'Present', exact: true })).toBeTruthy();
});

it('opens Present AI mind map directly in the enlarged view and closes back to the page', async () => {
  savedMap({ schemaVersion: 1, nodes: [
    { id: 'root', parentId: null, label: 'Saved topic', summary: '', sourceIds: ['canonical:page'] },
  ], warnings: [] });
  render(<PresentEntry viewId='document' />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present AI mind map' }));
  const canvas = await screen.findByRole('region', { name: 'Interactive mind map' });

  expect(canvas.classList.contains('ps-map-expanded')).toBe(true);
  expect(screen.queryByRole('navigation', { name: 'Page presentation tools' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Generate with AI' })).toBeNull();
  fireEvent.keyDown(canvas, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Interactive mind map' })).toBeNull());
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present AI mind map' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Close enlarged mind map' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Interactive mind map' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Present', exact: true })).toBeTruthy();
});

it('opens the server-saved mind map with canonical source numbers and native source navigation', async () => {
  savedMap({ schemaVersion: 1, warnings: [], nodes: [
    { id: 'root', parentId: null, label: 'Saved map', summary: '', sourceIds: ['canonical:page'] },
    { id: 'first', parentId: 'root', label: 'First topic', summary: 'First finding', sourceIds: ['canonical:heading', 'canonical:body'] },
    { id: 'second', parentId: 'root', label: 'Second topic', summary: 'Second finding', sourceIds: ['canonical:body'] },
  ] });
  render(<PresentEntry viewId='document' />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present AI mind map' }));
  fireEvent.click(await screen.findByRole('button', { name: 'First topic', exact: true }));
  expect(screen.getByLabelText('Open source 3: canonical:body').textContent).toBe('3');
  fireEvent.click(screen.getByRole('button', { name: 'Second topic', exact: true }));
  const source = screen.getByLabelText('Open source 3: canonical:body');

  expect(source.textContent).toBe('3');
  fireEvent.click(source);
  expect(mockToView).toHaveBeenCalledWith('document', 'body-live');
  expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/presentation/workspace/artifacts/saved-map', params: { version: 2 } }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Interactive mind map' })).toBeNull());
});

it('keeps a saved map from a different source revision out of current-page navigation', async () => {
  savedMap({ schemaVersion: 1, nodes: [
    { id: 'article', parentId: null, label: 'Imported AI article', summary: 'Actual source content', sourceIds: ['canonical:other-page'] },
  ], warnings: [] }, 'another-authorized-source-revision');
  render(<PresentEntry viewId='document' />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present AI mind map' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Imported AI article', exact: true }));
  fireEvent.click(screen.getByLabelText('Open source 1: canonical:other-page'));
  expect(await screen.findByText('Select the original source page and revision to follow this reference.')).toBeTruthy();
  expect(mockToView).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  await waitFor(() => expect(screen.queryByText('Select the original source page and revision to follow this reference.')).toBeNull());
  expect(await screen.findByRole('region', { name: 'Interactive mind map' })).toBeTruthy();
});

it('navigates an imported map only through its server-validated canonical reference', async () => {
  savedMap({ schemaVersion: 1, nodes: [
    { id: 'article', parentId: null, label: 'Imported AI article', summary: '', sourceIds: ['canonical:body'] },
  ], warnings: [] });
  render(<PresentEntry viewId='document' />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present AI mind map' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Imported AI article', exact: true }));
  fireEvent.click(screen.getByLabelText('Open source 1: canonical:body'));
  expect(mockToView).toHaveBeenCalledWith('document', 'body-live');
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Interactive mind map' })).toBeNull());
});

it('includes the source page cover on the title slide even when permissions come from another view', async () => {
  mockCover = { type: CoverType.BuildInImage, value: '3', offset: 0.6 };
  render(<PresentEntry viewId='document' permissionViewId='permission-view' />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present document' }));
  const slide = await screen.findByLabelText('Slide 1 of 2');
  const image = slide.querySelector('.ps-doc-cover img') as HTMLImageElement;

  expect(image.getAttribute('src')).toBe('/covers/m_cover_image_3.png');
  expect(image.style.objectPosition).toBe('50% 80%');
  // Measuring the title must not cause a duplicate authenticated image load.
  expect(document.querySelectorAll('.ps-doc-measure img')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
  expect(screen.getByLabelText('Slide 2 of 2').querySelector('.ps-doc-cover')).toBeNull();
});

it('resolves an empty row through the server without creating a client document', async () => {
  setActiveRowPage({
    rowId: 'row',
    documentId: 'row-document',
    title: 'Live project',
    hasDocument: false,
    source: null,
    getProperties: () => [{ id: 'property:budget', name: 'Budget', type: 'Number', value: null }],
  });
  render(<PresentEntry viewId='row-document' permissionViewId='database-view' isRow slidesOnly />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate AI ppt' }));
  await screen.findByRole('region', { name: 'Create presentation settings' });
  expect(mockPermissionHook).toHaveBeenLastCalledWith(
    expect.objectContaining({ view_id: 'database-view' }),
    true,
    'database-view'
  );
  expect(mockLoadView).not.toHaveBeenCalled();
  expect(mockLoadRowDocument).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Include database properties').checked).toBe(true);
});

it('retains viewer presentation access while disabling source-based generation', async () => {
  mockPermissions.canWrite = false;
  render(<PresentEntry viewId='document' slidesOnly />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate AI ppt' }));
  await screen.findByRole('region', { name: 'Create presentation settings' });
  expect(screen.getByRole('button', { name: 'Generate presentation' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close generation settings' }));
  render(<PresentEntry viewId='document' />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present document' }));
  expect(await screen.findByLabelText('Slide 1 of 2')).toBeTruthy();
});

it('opens presentation outside the Share popover and restores accessible page controls on exit', async () => {
  render(<ShareButton viewId='document' />);
  fireEvent.click(screen.getByTestId('share-button'));
  fireEvent.click(await screen.findByRole('button', { name: 'Create shared deck' }));
  await screen.findByRole('region', { name: 'Create presentation settings' });
  expect(screen.queryByRole('button', { name: 'Create shared deck' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close generation settings' }));
  expect(await screen.findByRole('button', { name: 'shareAction.buttonText' })).toBeTruthy();
});


it('presents an empty row locally with typed missing properties and never creates a document', async () => {
  setActiveRowPage({ rowId: 'row', documentId: 'row-document', title: 'Live project', hasDocument: false, source: null,
    getProperties: () => [{ id: 'property:budget', name: 'Budget', type: 'Number', value: null }] });
  render(<PresentEntry viewId='row-document' permissionViewId='database-view' isRow />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Present', exact: true }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Present document' }));
  expect(await screen.findByRole('heading', { name: 'Live project' })).toBeTruthy();
  expect(screen.getAllByText('Not provided').length).toBeGreaterThan(0);
  expect(mockLoadView).not.toHaveBeenCalled();
  expect(mockLoadRowDocument).not.toHaveBeenCalled();
  expect(mockRequest).not.toHaveBeenCalled();
});


it('cancels old-actor source reads and never renders their late content after identity changes', async () => {
  let finishOld: ((value: unknown) => void) | undefined;
  let oldSignal: AbortSignal | undefined;
  let firstSource = true;

  mockRequest.mockImplementation((config) => {
    if (config.url.endsWith('/sources')) {
      if (firstSource) {
        firstSource = false;
        oldSignal = config.signal;
        return new Promise((resolve) => { finishOld = resolve; });
      }
      return Promise.resolve({ status: 200, data: { code: 0, data: { ...mockSource(), title: 'New actor source' } }, headers: {} });
    }
    return mockWire(config);
  });
  const rendered = render(<PresentEntry viewId='document' slidesOnly />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate AI ppt' }));
  await waitFor(() => expect(finishOld).toBeDefined());
  mockUserId = 'new-user';
  rendered.rerender(<PresentEntry viewId='document' slidesOnly />);
  expect(await screen.findByText('New actor source')).toBeTruthy();
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => { finishOld?.({ status: 200, data: { code: 0, data: { ...mockSource(), title: 'Old private actor content' } }, headers: {} }); });
  expect(screen.queryByText('Old private actor content')).toBeNull();
});
