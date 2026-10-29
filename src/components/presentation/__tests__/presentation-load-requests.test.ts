import type { AxiosRequestConfig } from 'axios';

import { loadPresentation, loadSavedDeck, runGeneration } from '../presentation-client';
import { sourceToSnapshot } from '../server-adapter';

import type { Artifact, JobStatus, PresentationStatus, ServerSlidePlan, SourceEnvelope, StoredSession, Theme } from '../server-contract';
import type { DeckScene } from '../server-scene';
import type { MindMap } from '../types';

const mockRequest = jest.fn();

jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => ({ request: mockRequest }) }));
jest.mock('@/application/session/token', () => ({ captureTokenSession: () => ({ id: 'session' }), isTokenSessionCurrent: () => true }));

const scope = { workspaceId: 'workspace', pageId: 'page' };
const root = `/api/presentation/${scope.workspaceId}`;
const theme: Theme = { id: 'paper', name: 'Paper', description: '', color: '#112233', background: '#FFFFFF', textColor: '#112233', font: 'Arial', bodyFont: 'Arial', footer: '', palette: [], guidelines: '' };
const status = { schemaVersion: 1, promptBundleVersion: 'bundle', plan: 'free', remainingSlides: 10, themes: [theme], maxSlides: 20 } as unknown as PresentationStatus;
const plan: ServerSlidePlan = { schemaVersion: 1, title: 'Deck', slides: [{ id: 'slide', title: 'Title', layout: 'title', message: '', points: [], sourceIds: [], notes: '', warnings: [] }] };
const map: MindMap = { schemaVersion: 1, nodes: [{ id: 'root', parentId: null, label: 'Map', summary: '', sourceIds: [] }], warnings: [] };
const scene: DeckScene = { schemaVersion: 1, width: 1280, height: 720, title: 'Deck', style: { id: '00000000-0000-0000-0000-000000000000', version: 1 }, theme, slides: [], warnings: [] };
const source: SourceEnvelope = {
  schemaVersion: 1, title: 'Page', revision: 'revision', blocks: [], databaseViews: [], assets: [], dependencyRevisions: [], coverage: [], references: {},
  sources: [{ pageId: scope.pageId, title: 'Page', kind: 'document', revision: 'native', original: {} }],
};

function artifact<T>(id: string, content: T, version = 3): Artifact<T> {
  return { id, workspaceId: scope.workspaceId, version, content, resultHash: 'hash', sourceRevision: 'revision', generationJobId: null, origin: 'ai', createdAt: '2026-10-28T00:00:00Z',
    mapStyle: { structure: 'right-facing', branchLine: 'rounded' }, promptBundleVersion: null, compiledPromptChecksum: null, providerModel: null };
}
function ok(data: unknown) { return Promise.resolve({ status: 200, headers: {}, data: { code: 0, message: 'OK', data } }); }
function denied() { return Promise.reject({ isAxiosError: true, response: { status: 404, headers: {}, data: { code: 1024, reason: 'ARTIFACT_NOT_FOUND', retryable: false } } }); }
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });

  return { promise, resolve };
}
const calls = () => mockRequest.mock.calls.map(([config]: [AxiosRequestConfig]) => `${config.method ?? 'GET'} ${config.url}`);
// Lets pending request chains advance; Jest also fails the test if an abandoned read rejects unhandled meanwhile.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => mockRequest.mockReset());

test('opening the studio reads no deck catalog and reads the saved narrative as soon as the session arrives', async () => {
  const statusRead = deferred();
  const session = { workspaceId: scope.workspaceId, actorId: 'user', revision: 2, updatedAt: '', payload: { artifact: null, narrative: { id: 'map', version: 4 }, style: null, options: {}, mapStyle: {} } } as unknown as StoredSession;

  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    if (config.url === `${root}/status`) return statusRead.promise;
    if (config.url === `${root}/session`) return ok(session);
    if (config.url === `${root}/styles`) return ok({ items: [], nextCursor: null });
    if (config.url === `${root}/artifacts/map`) return ok(artifact('map', map, 4));
    throw new Error(`Unexpected request ${config.url}`);
  });
  const loading = loadPresentation(scope);

  await settle();
  // The narrative does not wait for the slower status read.
  expect(calls()).toContain(`GET ${root}/artifacts/map`);
  statusRead.resolve({ status: 200, headers: {}, data: { code: 0, message: 'OK', data: status } });
  const loaded = await loading;

  expect(loaded.mapArtifact?.id).toBe('map');
  expect(loaded.map).toEqual(map);
  expect(loaded).not.toHaveProperty('decks');
  expect(calls().some((call) => call.endsWith('/decks'))).toBe(false);
  expect(mockRequest).toHaveBeenCalledTimes(4);
});

test('a saved deck of a known version reads its artifact and scene together', async () => {
  const artifactRead = deferred();

  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    if (config.url === `${root}/artifacts/deck/scene`) return ok(scene);
    if (config.url === `${root}/artifacts/deck`) return artifactRead.promise;
    throw new Error(`Unexpected request ${config.url}`);
  });
  const loading = loadSavedDeck(scope, 'deck', 3);

  await settle();
  // Both reads are in flight while the artifact is still pending.
  expect(calls().sort()).toEqual([`GET ${root}/artifacts/deck`, `GET ${root}/artifacts/deck/scene`]);
  expect(mockRequest.mock.calls.find(([config]) => config.url.endsWith('/scene'))[0].params).toEqual({ version: 3 });
  artifactRead.resolve({ status: 200, headers: {}, data: { code: 0, message: 'OK', data: artifact('deck', plan) } });
  await expect(loading).resolves.toMatchObject({ id: 'deck', version: 3, plan, style: { id: theme.id } });
});

test('without a version the scene read waits for the version the artifact reports', async () => {
  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    if (config.url === `${root}/artifacts/deck/scene`) return ok(scene);
    if (config.url === `${root}/artifacts/deck`) return ok(artifact('deck', plan, 7));
    throw new Error(`Unexpected request ${config.url}`);
  });
  await loadSavedDeck(scope, 'deck');
  expect(calls()).toEqual([`GET ${root}/artifacts/deck`, `GET ${root}/artifacts/deck/scene`]);
  expect(mockRequest.mock.calls[1][0].params).toEqual({ version: 7 });
});

test('a non-deck artifact reports the kind mismatch, not the failed parallel scene read', async () => {
  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    // The scene endpoint rejects a map before its artifact read completes.
    if (config.url === `${root}/artifacts/map/scene`) return denied();
    if (config.url === `${root}/artifacts/map`) return settle().then(() => ok(artifact('map', map)));
    throw new Error(`Unexpected request ${config.url}`);
  });
  await expect(loadSavedDeck(scope, 'map', 3)).rejects.toMatchObject({ code: 'ARTIFACT_KIND_MISMATCH' });
  await settle();
});

test('a failed artifact read reports its own error and leaves no unhandled scene rejection', async () => {
  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    if (config.url === `${root}/artifacts/deck/scene`) return settle().then(denied);
    if (config.url === `${root}/artifacts/deck`) return Promise.reject({ isAxiosError: true, response: { status: 403, headers: {}, data: { code: 1012, reason: 'SOURCE_ACCESS_DENIED', retryable: false } } });
    throw new Error(`Unexpected request ${config.url}`);
  });
  await expect(loadSavedDeck(scope, 'deck', 3)).rejects.toMatchObject({ code: 'SOURCE_ACCESS_DENIED' });
  await settle();
  await settle();
});

describe('a finished generation', () => {
  const input = (task: 'slides' | 'mindmap') => ({
    scope, task, requestId: 'request', source: sourceToSnapshot(source),
    options: { audience: '', slideCount: 6, instructions: '', includeProperties: false, allowWebSearch: false },
  });
  const job = (kind: JobStatus['kind'], id: string): JobStatus => ({ id: 'job', state: 'succeeded', kind, sourceRevision: 'revision', artifactId: id, resultVersion: 3, committedUnits: 1, errorReason: null });

  test('reads a deck scene together with its artifact', async () => {
    const artifactRead = deferred();

    mockRequest.mockImplementation((config: AxiosRequestConfig) => {
      if (config.url === `${root}/generate`) return ok(job('slides', 'deck'));
      if (config.url === `${root}/status`) return ok(status);
      if (config.url === `${root}/artifacts/deck/scene`) return ok(scene);
      if (config.url === `${root}/artifacts/deck`) return artifactRead.promise;
      throw new Error(`Unexpected request ${config.url}`);
    });
    const running = runGeneration(input('slides'));

    await settle();
    expect(calls()).toContain(`GET ${root}/artifacts/deck/scene`);
    artifactRead.resolve({ status: 200, headers: {}, data: { code: 0, message: 'OK', data: artifact('deck', plan) } });
    await expect(running).resolves.toMatchObject({ deck: { id: 'deck', version: 3 } });
  });

  test('does not read a scene for a mind map', async () => {
    mockRequest.mockImplementation((config: AxiosRequestConfig) => {
      if (config.url === `${root}/generate`) return ok(job('mindmap', 'map'));
      if (config.url === `${root}/status`) return ok(status);
      if (config.url === `${root}/artifacts/map`) return ok(artifact('map', map));
      throw new Error(`Unexpected request ${config.url}`);
    });
    await expect(runGeneration(input('mindmap'))).resolves.toMatchObject({ map });
    expect(calls().some((call) => call.endsWith('/scene'))).toBe(false);
  });

  test('reports a failed status read without an unhandled scene rejection', async () => {
    mockRequest.mockImplementation((config: AxiosRequestConfig) => {
      if (config.url === `${root}/generate`) return ok(job('slides', 'deck'));
      if (config.url === `${root}/status`) return Promise.reject({ isAxiosError: true, response: { status: 409, headers: {}, data: { code: 4001, reason: 'AI_ACCOUNTING_NOT_READY', retryable: false } } });
      if (config.url === `${root}/artifacts/deck/scene`) return settle().then(denied);
      if (config.url === `${root}/artifacts/deck`) return ok(artifact('deck', plan));
      throw new Error(`Unexpected request ${config.url}`);
    });
    await expect(runGeneration(input('slides'))).rejects.toMatchObject({ code: 'AI_ACCOUNTING_NOT_READY' });
    await settle();
    await settle();
  });
});
