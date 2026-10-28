import type { AxiosRequestConfig } from 'axios';

import {
  createGenerationRunner, exportDeck, importPresentationTemplate, loadPresentation, loadSourceSnapshot,
  reviewPresentationStyle, waitForJob,
} from '../presentation-client';
import { entitlementForStatus, generationRequest, serverOptions, sourceToSnapshot, themeToStyle, toServerPlan, uiOptions } from '../server-adapter';
import * as client from '../server-client';
import type { Artifact, JobStatus, PresentationStatus, ReviewedStyle, ServerSlidePlan, SourceEnvelope, Theme } from '../server-contract';
import type { DeckScene } from '../server-scene';
import type { GenerationOptions } from '../types';

const mockRequest = jest.fn();
let mockSessionCurrent = true;

jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => ({ request: mockRequest }) }));
jest.mock('@/application/session/token', () => ({ captureTokenSession: () => ({ id: 'signed-in-lifetime' }), isTokenSessionCurrent: () => mockSessionCurrent }));

const scope = { workspaceId: '27387b91-1919-4ce6-bba0-a1456d3be718', pageId: '37d01578-4109-4604-9358-9342b53f1864' };
const id = '6424a3b8-5300-45a7-8b30-f7b53d19f307';
const theme: Theme = { id: 'paper', name: 'Paper', description: 'Trusted theme', color: '#112233', background: '#FFFFFF', textColor: '#112233', font: 'Arial', bodyFont: 'Arial', footer: 'Trusted footer', palette: ['#112233'], guidelines: '' };
const source: SourceEnvelope = {
  schemaVersion: 1, title: 'Project', revision: 'full-envelope-revision',
  sources: [{ pageId: scope.pageId, title: 'Project', kind: 'document', revision: 'native-page-revision', original: { data: 'server snapshot' } }],
  blocks: [{ id: 'native-block', pageId: scope.pageId, kind: 'paragraph', text: 'Evidence', sourceIds: ['page:block:canonical'], children: [], semantic: {} }],
  databaseViews: [], assets: [],
  references: { 'page:block:canonical': { location: { kind: 'document', pageId: scope.pageId, revision: 'native-page-revision', blockId: 'native-block', propertyId: null }, evidenceKind: 'original', numeric: null } },
  dependencyRevisions: [{ kind: 'page', id: scope.pageId, revision: 'native-page-revision' }], coverage: [],
};
const options: GenerationOptions = { slideCount: 6, slideCountMode: 'fixed', audience: '', instructions: '', includeProperties: false, allowWebSearch: false };
const plan: ServerSlidePlan = { schemaVersion: 2, title: 'Project', slides: [{ id: 'slide-a', title: 'Project', layout: 'title', message: 'Evidence', points: [], sourceIds: ['page:block:canonical'], notes: 'Notes', warnings: [], assets: [{ assetId: id, revision: 'image-v1', sourceId: 'media:canonical', attribution: 'Original source', kind: 'image', placement: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, timeMs: null }] }] };
const job: JobStatus = { id, state: 'succeeded', kind: 'slides', sourceRevision: source.revision, artifactId: id, resultVersion: 3, committedUnits: 1, errorReason: null };
const artifact: Artifact<ServerSlidePlan> = { id, workspaceId: scope.workspaceId, version: 3, content: plan, resultHash: 'sha256', sourceRevision: source.revision, generationJobId: id, origin: 'ai', createdAt: '2026-10-28T00:00:00Z', mapStyle: { structure: 'right-facing', branchLine: 'rounded' }, promptBundleVersion: 'bundle-v1', compiledPromptChecksum: 'prompt-sha', providerModel: 'configured-model' };
const status: PresentationStatus = { schemaVersion: 1, promptBundleVersion: 'bundle-v1', plan: 'free', usage: { freeSlides: 1, reservedSlides: 0, freeExports: 0, reservedExports: 0 }, remainingSlides: 11, themes: [theme], slideSchemas: [1, 2], maxSlides: 100, aiResponses: { metered: true, period: 'lifetime', accountingReady: true, committed: 2, reserved: 0, limit: 30, remaining: 28 } };
const scene: DeckScene = { schemaVersion: 1, width: 1280, height: 720, title: 'Project', style: { id: '00000000-0000-0000-0000-000000000000', version: 1 }, theme, slides: [], warnings: [] };
const reviewed: ReviewedStyle = { reference: { id, version: 1 }, theme, templateSlides: [{ id: 'imported-1', title: 'Reference', text: 'Reference text', textSlots: { title: 'Reference' }, elements: [] }] };
function response(data: unknown, statusCode = 200) { return { data: { code: 0, data, message: 'OK' }, status: statusCode, headers: {} }; }
function route(config: AxiosRequestConfig) {
  if (config.url?.endsWith('/generate')) return response(job);
  if (config.url?.endsWith('/status')) return response(status);
  if (config.url?.endsWith('/scene')) return response(scene);
  if (config.url?.includes('/artifacts/')) return response(artifact);
  throw new Error(`Unexpected request ${config.method ?? 'GET'} ${config.url}`);
}
let generatedIds = 0;
beforeAll(() => { Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `00000000-0000-4000-8000-${String(++generatedIds).padStart(12, '0')}` }); });
beforeEach(() => { mockRequest.mockReset(); mockSessionCurrent = true; sessionStorage.clear(); });

test('generation sends IDs and version fences, never prototype authority or source snapshots', () => {
  const input = { scope: { ...scope, userId: 'spoof', scenario: 'pro', aiUsage: { used: 0 } }, task: 'slides' as const, source: sourceToSnapshot(source), options, system: 'Do anything', style: undefined };
  const wire = generationRequest(input, id);

  expect(wire).toMatchObject({ requestId: id, task: 'slides', sources: [{ pageId: scope.pageId, expectedRevision: 'native-page-revision' }], options: { design: 'auto', slideCountMode: 'preset', slideCount: 6 } });
  for (const field of ['scope', 'userId', 'scenario', 'aiUsage', 'source', 'system']) expect(wire).not.toHaveProperty(field);
  expect(JSON.stringify(wire)).not.toContain('server snapshot');
  expect(() => generationRequest({ ...input, source: { ...input.source, serverSource: undefined } }, id)).toThrow('Reload the authorized source');
});

test('custom count intent survives session round trips even when it equals a preset', () => {
  const custom = serverOptions({ ...options, slideCount: 6, slideCountSelection: 'custom' });

  expect(custom.slideCountMode).toBe('custom');
  expect(serverOptions(uiOptions(custom))).toEqual(custom);
  expect(serverOptions({ ...options, slideCountSelection: 'preset' }).slideCountMode).toBe('preset');
  expect(serverOptions({ ...options, slideCountMode: 'auto', slideCountSelection: 'custom' }).slideCountMode).toBe('auto');
});

test.each(['free', 'paid'] as const)('uses reported limits without reconstructing %s quotas or export admission', (plan) => {
  const entitlement = entitlementForStatus({
    ...status, plan, remainingSlides: 19, maxSlides: 23,
    usage: { freeSlides: 600, reservedSlides: 20, freeExports: 50, reservedExports: 8 },
  });

  expect(entitlement).toMatchObject({ remainingSlides: 19, maxSlides: 23, canGenerate: true });
  expect(entitlement).not.toHaveProperty('canExport');
  expect(entitlement).not.toHaveProperty('consumed');
  expect(entitlementForStatus({ ...status, plan, remainingSlides: 0 }).canGenerate).toBe(false);
});

test('all 25 business routes use authenticated Cloud paths, CAS queries and private binary reads', async () => {
  mockRequest.mockImplementation((config: AxiosRequestConfig) => Promise.resolve(config.responseType === 'blob'
    ? { data: new Blob(['bytes']), headers: { 'content-disposition': 'attachment; filename="project.pptx"' }, status: 200 }
    : response(null)));
  const assessment = { sources: [{ pageId: scope.pageId }], options: serverOptions(options) };
  const map = { schemaVersion: 1 as const, nodes: [], warnings: [] };
  const reference = { id, version: 3 };
  const session = { artifact: reference, narrative: null, style: null, options: assessment.options, mapStyle: { structure: 'right-facing' as const, branchLine: 'rounded' as const } };
  const calls = [
    client.getPresentationStatus(scope), client.resolveSources(scope, assessment), client.assessSources(scope, assessment),
    client.submitGeneration(scope, { ...assessment, requestId: id, task: 'slides' }), client.getJob(scope, id), client.cancelJob(scope, id),
    client.importDeck(scope, { ...assessment, id, deck: plan }), client.listDecks(scope), client.listMaps(scope), client.listStyleRecords(scope),
    client.importMap(scope, { ...assessment, id, map, sourceMapping: { external: 'page:block:canonical' } }), client.createStructuralMap(scope, assessment),
    client.editMap(scope, { id, expectedVersion: 3, map }), client.listArtifacts(scope, 'deck'), client.readArtifact(scope, id, 3), client.deleteArtifact(scope, id, 3),
    client.listArtifactVersions(scope, id, 3), client.getSession(scope), client.saveSession(scope, 2, session),
    client.uploadTemplate(scope, new File(['zip'], 'brand.pptx')), client.reviewStyle(scope, id, 1, reviewed), client.getArtifactScene(scope, id, 3),
    client.getArtifactAsset(scope, id, 3, id, 'image-v1'), client.submitExport(scope, reference, id), client.downloadExport(scope, id),
  ];

  await Promise.all(calls);
  const configs = mockRequest.mock.calls.map(([config]) => config);
  const root = `/api/presentation/${scope.workspaceId}`;

  expect(configs.map((config) => `${config.method ?? 'GET'} ${config.url}`)).toEqual([
    `GET ${root}/status`, `POST ${root}/sources`, `POST ${root}/slides/assess`, `POST ${root}/generate`, `GET ${root}/jobs/${id}`, `DELETE ${root}/jobs/${id}`,
    `POST ${root}/decks`, `GET ${root}/decks`, `GET ${root}/map`, `GET ${root}/styles`, `POST ${root}/map/import`, `POST ${root}/map/structure`, `PUT ${root}/map/${id}`,
    `GET ${root}/artifacts`, `GET ${root}/artifacts/${id}`, `DELETE ${root}/artifacts/${id}`, `GET ${root}/artifacts/${id}/versions`, `GET ${root}/session`, `PUT ${root}/session`,
    `POST ${root}/template`, `PUT ${root}/styles/${id}/review`, `GET ${root}/artifacts/${id}/scene`, `GET ${root}/artifacts/${id}/assets/${id}`, `POST ${root}/download`, `GET ${root}/exports/${id}/download`,
  ]);
  expect(configs.every((config) => config.skipResponseCache === true)).toBe(true);
  expect(configs[15].params).toEqual({ expectedVersion: 3 });
  expect(configs[18].data).toEqual({ expectedRevision: 2, session });
  expect(configs[19].data).toBeInstanceOf(File);
  expect(configs[19].params).toEqual({ filename: 'brand.pptx' });
  expect(configs[22]).toMatchObject({ responseType: 'blob', params: { version: 3, revision: 'image-v1' } });
});

test.each([402, 409, 429, 503])('preserves Cloud HTTP %i reason, details and retry metadata', async (httpStatus) => {
  mockRequest.mockRejectedValue({ isAxiosError: true, response: { status: httpStatus, headers: { 'retry-after': '4' }, data: { code: 4001, message: 'SLIDE_GENERATION_LIMIT', reason: 'SLIDE_GENERATION_LIMIT', retryable: httpStatus >= 429, details: { remaining: 2 } } } });
  await expect(client.getPresentationStatus(scope)).rejects.toMatchObject({ code: 'SLIDE_GENERATION_LIMIT', status: httpStatus, retryable: httpStatus >= 429, serverCode: 4001, retryAfterSecs: 4, details: { remaining: 2 } });
});

test.each([
  ['RESOURCE_NOT_FOUND', 404, 'no longer available'],
  ['INCOMPLETE_SOURCE', 400, "can't use yet"],
  ['SOURCE_PROCESSING_BUSY', 429, 'busy'],
])('source preparation reason %s reads as a sentence, never the raw code', async (reason, httpStatus, text) => {
  mockRequest.mockRejectedValue({ isAxiosError: true, response: { status: httpStatus, headers: {}, data: { code: -2, message: reason, reason, retryable: httpStatus === 429 } } });
  const failure = await client.resolveSources(scope, { sources: [{ pageId: 'page' }], options: serverOptions() }).catch((error: unknown) => error);

  expect(failure).toMatchObject({ code: reason, status: httpStatus });
  expect((failure as Error).message).toContain(text);
  expect((failure as Error).message).not.toBe(reason);
});

test('legacy HTTP-200 error envelopes do not masquerade as successful data', async () => {
  mockRequest.mockResolvedValue({ status: 200, data: { code: 1012, message: 'Not enough permissions' }, headers: {} });
  await expect(client.getPresentationStatus(scope)).rejects.toMatchObject({ status: 200, serverCode: 1012 });
});

test('unknown AI accounting never becomes zero or unlimited', () => {
  const unknown = entitlementForStatus({ ...status, aiResponses: { accountingReady: false, reason: 'AI_ACCOUNTING_NOT_READY', retryable: true } });

  expect(unknown).toMatchObject({ canGenerateMap: false, aiAccountingReady: false, aiResponsesUsed: null, aiResponsesRemaining: null, canGenerate: true });
  expect(entitlementForStatus({ ...status, aiResponses: { metered: false, policy: 'licensed_self_host' } }).canGenerateMap).toBe(true);
  expect(entitlementForStatus({ ...status, aiResponses: { metered: true, accountingReady: true, committed: 55, reserved: 1, limit: null, remaining: null } }).canGenerateMap).toBe(true);
});

test('canonical references and schema-v2 media survive source and plan projections', () => {
  const snapshot = sourceToSnapshot(source);

  expect(snapshot.serverSource).toBe(source);
  expect(snapshot.blocks[0].id).toBe('page:block:canonical');
  expect(toServerPlan(plan)).toEqual(plan);
  const changed = toServerPlan({ ...plan, slides: plan.slides.map((slide) => ({ ...slide, title: 'Edited' })) });

  expect(changed.slides[0].assets).toEqual(plan.slides[0].assets);
  expect(changed.slides[0].sourceIds).toEqual(['page:block:canonical']);
  expect(changed.schemaVersion).toBe(2);
});

test('database evidence keeps zero, false, missing and canonical cell IDs distinct', () => {
  const coverage = { sourceId: null, status: 'included' as const, total: 1, matched: 1, included: 1, selection: null, warning: null };
  const snapshot = sourceToSnapshot({ ...source, blocks: [], databaseViews: [{ databaseId: id, viewId: scope.pageId, name: 'Metrics', viewType: 'grid', selectedTab: null, schema: [], filters: null, sorts: null, groups: null, coverage,
    rows: [{ rowId: id, revision: 'r1', cells: { zero: { sourceId: 'cell:zero', value: { type: 'number', value: 0, unit: '' } }, no: { sourceId: 'cell:no', value: { type: 'boolean', value: false } }, absent: { sourceId: 'cell:absent', value: { type: 'unknown' } } } }] }] });

  expect(snapshot.blocks.map(({ id: ref, text }) => [ref, text])).toEqual([['cell:zero', 'Metrics · zero: 0'], ['cell:no', 'Metrics · no: false'], ['cell:absent', 'Metrics · absent: Unknown']]);
});

test('generation recovers the same key after transport failure and consumes the saved artifact without reimport', async () => {
  const runner = createGenerationRunner();
  const input = { scope, task: 'slides' as const, source: sourceToSnapshot(source), options };

  mockRequest.mockRejectedValueOnce({ isAxiosError: true, message: 'connection lost' }).mockImplementation((config) => Promise.resolve(route(config)));
  await expect(runner(input)).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
  const result = await runner(input);
  const submissions = mockRequest.mock.calls.map(([config]) => config).filter((config) => config.url.endsWith('/generate'));

  expect(submissions[0].data.requestId).toBe(submissions[1].data.requestId);
  expect(result.deck).toMatchObject({ id, version: 3, serverPlan: plan, sourceRevision: source.revision });
  expect(result.status).toEqual(status);
  expect(result.deck?.style.serverStyle).toBeUndefined(); // Built-in Uuid::nil is not a saved custom style.
  expect(mockRequest.mock.calls.some(([config]) => config.method === 'POST' && config.url.endsWith('/decks'))).toBe(false);
});

test('changed generation inputs allocate a fresh operation key after uncertain transport', async () => {
  const runner = createGenerationRunner();
  const input = { scope, task: 'slides' as const, source: sourceToSnapshot(source), options };

  mockRequest.mockRejectedValue({ isAxiosError: true });
  await expect(runner(input)).rejects.toBeDefined();
  await expect(runner({ ...input, options: { ...options, slideCount: 8 } })).rejects.toBeDefined();
  expect(mockRequest.mock.calls[0][0].data.requestId).not.toBe(mockRequest.mock.calls[1][0].data.requestId);
});

test('a reload resubmits a pending generation with its original operation key', async () => {
  const input = { scope, task: 'slides' as const, source: sourceToSnapshot(source), options };

  mockRequest.mockRejectedValueOnce({ isAxiosError: true, message: 'connection lost' }).mockImplementation((config) => Promise.resolve(route(config)));
  await expect(createGenerationRunner()(input)).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
  // A new runner stands in for the reloaded page; the server replays the first job.
  await createGenerationRunner()(input);
  const submissions = mockRequest.mock.calls.map(([config]) => config).filter((config) => config.url.endsWith('/generate'));

  expect(submissions[1].data.requestId).toBe(submissions[0].data.requestId);
  expect(JSON.stringify({ ...sessionStorage })).not.toContain('native-page-revision');
  // Success clears it, so the next generation is a new operation.
  await createGenerationRunner()(input);
  const third = mockRequest.mock.calls.map(([config]) => config).filter((config) => config.url.endsWith('/generate'))[2];

  expect(third.data.requestId).not.toBe(submissions[0].data.requestId);
});

test('abort cancels the known live job and confirmed cancellation clears the runner key', async () => {
  const controller = new AbortController();
  const runner = createGenerationRunner();
  const input = { scope, task: 'slides' as const, source: sourceToSnapshot(source), options };
  let first = true;

  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    if (config.method === 'DELETE') return Promise.resolve(response({ ...job, state: 'canceled' }));
    if (config.url?.endsWith('/generate') && first) { first = false; return Promise.resolve(response({ ...job, state: 'queued' })); }
    return Promise.resolve(route(config));
  });
  await expect(runner(input, controller.signal, (value) => { if (value.state === 'queued') controller.abort(); })).rejects.toMatchObject({ name: 'AbortError' });
  await runner(input);
  const submissions = mockRequest.mock.calls.map(([config]) => config).filter((config) => config.url.endsWith('/generate'));

  expect(submissions[0].data.requestId).not.toBe(submissions[1].data.requestId);
  expect(mockRequest.mock.calls.some(([config]) => config.method === 'DELETE' && config.url.endsWith(`/jobs/${id}`))).toBe(true);
});

test('polling follows the durable job and stops at its terminal error', async () => {
  jest.useFakeTimers();
  mockRequest.mockResolvedValue(response({ ...job, state: 'failed', errorReason: 'SOURCE_REVISION_CONFLICT' }));
  const running = waitForJob(scope, { ...job, state: 'running' });
  const failure = expect(running).rejects.toMatchObject({ code: 'SOURCE_REVISION_CONFLICT', details: { jobId: id, state: 'failed' } });

  jest.advanceTimersByTime(1000);
  await failure;
  expect(mockRequest).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test('polling backs off and keeps following the job through transient status failures', async () => {
  jest.useFakeTimers();
  mockRequest
    .mockImplementationOnce(() => Promise.resolve(response({ ...job, state: 'running' })))
    .mockImplementationOnce(() => Promise.reject({ isAxiosError: true, response: { status: 503, data: { code: 1032, reason: 'PERSISTENCE_UNAVAILABLE', retryable: true } } }))
    .mockImplementationOnce(() => Promise.resolve(response(job)));
  const running = waitForJob(scope, { ...job, state: 'running' });

  await jest.advanceTimersByTimeAsync(1000);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  // The second poll waits longer than the first.
  await jest.advanceTimersByTimeAsync(1000);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(500);
  expect(mockRequest).toHaveBeenCalledTimes(2);
  // A retryable status failure does not end the wait for a durable job.
  await jest.advanceTimersByTimeAsync(3000);
  await expect(running).resolves.toMatchObject({ state: 'succeeded' });
  expect(mockRequest).toHaveBeenCalledTimes(3);
  jest.useRealTimers();
});

test('polling stops on a permanent status failure', async () => {
  jest.useFakeTimers();
  mockRequest.mockImplementationOnce(() => Promise.reject({ isAxiosError: true, response: { status: 403, data: { code: 1012, reason: 'SOURCE_ACCESS_DENIED', retryable: false } } }));
  const running = waitForJob(scope, { ...job, state: 'running' });
  const failure = expect(running).rejects.toMatchObject({ code: 'SOURCE_ACCESS_DENIED' });

  await jest.advanceTimersByTimeAsync(1000);
  await failure;
  jest.useRealTimers();
});

test('private export delivery reuses its request ID and exposes a Blob instead of a public URL', async () => {
  const bytes = new Blob(['PK native pptx'], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });

  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    if (config.method === 'POST') return Promise.resolve(response({ ...job, kind: 'export' }, 202));
    if (config.url?.endsWith('/download')) return Promise.resolve({ data: bytes, headers: { 'content-disposition': 'attachment; filename="project.pptx"' } });
    return Promise.resolve(route(config));
  });
  const result = await exportDeck(scope, { id, version: 3 }, 'retained-export-key');

  expect(mockRequest.mock.calls[0][0].data).toEqual({ requestId: 'retained-export-key', artifact: { id, version: 3 } });
  expect(result.blob).toBe(bytes);
  expect(result.fileName).toBe('project.pptx');
  expect(result).not.toHaveProperty('url');
});

test('template upload remains an unreviewed candidate until the explicit versioned review succeeds', async () => {
  mockRequest.mockResolvedValueOnce(response({ style: reviewed, requiresReview: true, warnings: ['Unsupported artwork omitted'] }));
  const candidate = await importPresentationTemplate(scope, new File(['zip'], 'brand.pptx'));

  expect(candidate.requiresReview).toBe(true);
  expect(() => generationRequest({ scope, task: 'slides', source: sourceToSnapshot(source), options, style: candidate }, id)).toThrow('Review and save');
  mockRequest.mockResolvedValueOnce(response({ ...artifact, version: 2, content: { ...reviewed, reference: { id, version: 2 } }, origin: 'reviewed_style' }));
  const approved = await reviewPresentationStyle(scope, candidate);

  expect(mockRequest.mock.calls[1][0].data).toEqual({ expectedVersion: 1, style: reviewed });
  expect(approved).toMatchObject({ requiresReview: false, reviewed: true, serverVersion: 2 });
});

test('source resolution sends only selected page IDs and ignores editor snapshot content', async () => {
  mockRequest.mockResolvedValue(response(source));
  const resolved = await loadSourceSnapshot(scope.workspaceId, scope.pageId);

  expect(mockRequest.mock.calls[0][0].data.sources).toEqual([{ pageId: scope.pageId }]);
  expect(resolved.revision).toBe(source.revision);
  expect(resolved.serverSource?.sources[0].revision).toBe('native-page-revision');
});

test('theme design mode resolves sources with the selected theme identity', async () => {
  mockRequest.mockResolvedValue(response(source));
  await loadSourceSnapshot(scope.workspaceId, scope.pageId, { ...options, designMode: 'theme' }, undefined, themeToStyle(theme));

  // Cloud rejects theme mode without a trusted theme ID before resolving any source.
  expect(mockRequest.mock.calls[0][0].data.options).toMatchObject({ design: 'theme', themeId: theme.id });
});

test('select evidence shows option names, not the ids kept for filters', () => {
  const view = {
    databaseId: id, viewId: id, name: 'Tasks', viewType: 'grid' as const, selectedTab: null, schema: {}, filters: [], sorts: [], groups: {},
    rows: [{ rowId: id, revision: 'row-v1', cells: { Status: { sourceId: 'cell:status', value: { type: 'structured' as const, kind: 'select', value: [{ id: 'done', name: 'Done' }, { id: 'later', name: 'Later' }] } } } }],
    coverage: { sourceId: null, status: 'included', total: 1, matched: 1, included: 1, selection: null, warning: null },
  };
  const snapshot = sourceToSnapshot({ ...source, databaseViews: [view] } as unknown as SourceEnvelope);

  expect(snapshot.blocks.find((block) => block.id === 'cell:status')?.text).toBe('Tasks · Status: Done, Later');
});

test('responses arriving after the login lifetime changes are not exposed to the new actor', async () => {
  mockRequest.mockImplementation(() => { mockSessionCurrent = false; return Promise.resolve(response(status)); });
  await expect(client.getPresentationStatus(scope)).rejects.toMatchObject({ name: 'AbortError' });
});


test('a revoked saved preference does not hide authorized workspace data or invent a session revision', async () => {
  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    if (config.url?.endsWith('/session')) return Promise.reject({ isAxiosError: true, response: { status: 403, data: { code: 1012, reason: 'SOURCE_PERMISSION_DENIED' } } });
    if (config.url?.endsWith('/decks') || config.url?.endsWith('/styles')) return Promise.resolve(response({ items: [], nextCursor: null }));
    return Promise.resolve(route(config));
  });
  const loaded = await loadPresentation(scope);

  expect(loaded.status).toEqual(status);
  expect(loaded.session).toBeUndefined();
  expect(loaded.warnings).toHaveLength(1);
  expect(mockRequest.mock.calls.some(([config]) => config.method === 'PUT')).toBe(false);
});

test('a successful generation keeps its key if the authoritative status read fails', async () => {
  const runner = createGenerationRunner();
  const input = { scope, task: 'slides' as const, source: sourceToSnapshot(source), options };
  let failStatus = true;

  mockRequest.mockImplementation((config: AxiosRequestConfig) => {
    if (config.url?.endsWith('/status') && failStatus) {
      failStatus = false;
      return Promise.reject({ isAxiosError: true, response: { status: 409, data: { code: 4001, reason: 'AI_ACCOUNTING_NOT_READY', retryable: false } } });
    }
    return Promise.resolve(route(config));
  });
  await expect(runner(input)).rejects.toMatchObject({ code: 'AI_ACCOUNTING_NOT_READY' });
  await runner(input);
  const submissions = mockRequest.mock.calls.map(([config]) => config).filter((config) => config.url.endsWith('/generate'));

  expect(submissions[0].data.requestId).toBe(submissions[1].data.requestId);
});

test('valid scalar semantic metadata does not crash the server source projection', () => {
  const snapshot = sourceToSnapshot({ ...source, blocks: [{ ...source.blocks[0], semantic: null }] });

  expect(snapshot.blocks[0].text).toBe('Evidence');
  expect(snapshot.serverSource?.blocks[0].semantic).toBeNull();
});


test('native row_properties semantic arrays retain canonical IDs, zero, false and missing values', () => {
  const snapshot = sourceToSnapshot({ ...source, blocks: [{ id: `properties:${scope.pageId}`, pageId: scope.pageId, kind: 'row_properties', text: '', children: [], sourceIds: ['property:zero', 'property:no', 'property:unknown'], semantic: [
    { fieldId: 'budget', name: 'Budget', sourceId: 'property:zero', value: { type: 'number', value: 0, unit: 'USD' } },
    { fieldId: 'done', name: 'Done', sourceId: 'property:no', value: { type: 'boolean', value: false } },
    { fieldId: 'cost', name: 'Cost', sourceId: 'property:unknown', value: { type: 'unknown' } },
  ] }] });

  expect(snapshot.properties).toEqual([
    { id: 'property:zero', name: 'Budget', type: 'number', value: 0 },
    { id: 'property:no', name: 'Done', type: 'boolean', value: false },
    { id: 'property:unknown', name: 'Cost', type: 'unknown', value: null },
  ]);
  expect(snapshot.blocks).toEqual([]);
});
