/** Cloud presentation workflows: request identity, job polling and UI projections. */
import { captureTokenSession, isTokenSessionCurrent } from '@/application/session/token';

import {
  artifactToDeck, generationRequest, isMapArtifact, reviewedStyleToStyle, serverOptions, sourceSelections,
  sourceToSnapshot, styleReference, type GenerateInput,
} from './server-adapter';
import {
  cancelJob, createStructuralMap, downloadExport, getArtifactScene, getJob, getPresentationStatus,
  getSession, listDecks, listStyleRecords, PresentationAPIError, presentationErrorMessage, readArtifact,
  resolveSources, assessSources, reviewStyle, submitExport, submitGeneration, uploadTemplate, findReusableResult, analyzeTemplate,
} from './server-client';

import type {
  Artifact, ArtifactSummary, AssessmentResponse, JobStatus, PresentationScope, PresentationStatus, ReviewedStyle,
  ServerSlidePlan, StoredSession, VersionedId,
} from './server-contract';
import type { GenerationOptions, MindMap, PageSnapshot, PresentationStyle, SavedDeck } from './types';

export * from './server-client';
export * from './server-adapter';
export * from './server-contract';

/** The style matters: theme design mode is valid only with the selected theme's identity. */
export async function loadSourceSnapshot(workspaceId: string, pageId: string, options?: Partial<GenerationOptions>, signal?: AbortSignal, style?: PresentationStyle): Promise<PageSnapshot> {
  return sourceToSnapshot(await resolveSources(workspaceId, { sources: [{ pageId }], options: serverOptions(options, style) }, signal), pageId);
}

export function assessPresentation(input: { scope: PresentationScope; source: PageSnapshot; options: GenerationOptions; style?: PresentationStyle }, signal?: AbortSignal): Promise<AssessmentResponse> {
  return assessSources(input.scope, { sources: sourceSelections(input.source), options: serverOptions(input.options, input.style), style: styleReference(input.style) }, signal);
}

export function loadStructuralMap(scope: PresentationScope, source: PageSnapshot, options?: Partial<GenerationOptions>, signal?: AbortSignal): Promise<Artifact<MindMap>> {
  return createStructuralMap(scope, { sources: sourceSelections(source), options: serverOptions(options) }, signal);
}

/** Starts a scene read beside its artifact read. Its error reaches callers only where they await it, after their artifact checks; an abandoned read never rejects unhandled. */
function sceneRead(scope: PresentationScope, id: string, version: number, signal?: AbortSignal) {
  const scene = getArtifactScene(scope, id, version, signal);

  scene.catch(() => undefined);
  return scene;
}

/** Only the server scene establishes the captured appearance of a saved deck. */
export async function loadSavedDeck(scope: PresentationScope, id: string, version?: number, signal?: AbortSignal): Promise<SavedDeck> {
  const scene = version === undefined ? undefined : sceneRead(scope, id, version, signal);
  const artifact = await readArtifact<ServerSlidePlan>(scope, id, version, signal);

  if (!Array.isArray(artifact.content.slides)) throw new PresentationAPIError('This artifact is not a presentation.', 'ARTIFACT_KIND_MISMATCH', 400);
  return artifactToDeck(artifact, await (scene ?? getArtifactScene(scope, artifact.id, artifact.version, signal)));
}

/** First authorized workspace catalog page. The API does not expose a page-ID filter. */
export async function listSavedDecks(scope: PresentationScope, signal?: AbortSignal): Promise<SavedDeck[]> {
  const page = await listDecks(scope, undefined, 30, signal);
  const decks: SavedDeck[] = [];

  // Bound artifact/scene reads rather than submitting 60 requests in one burst.
  for (let start = 0; start < page.items.length; start += 4) {
    decks.push(...await Promise.all(page.items.slice(start, start + 4).map((item) => loadSavedDeck(scope, item.id, item.version, signal))));
  }

  return decks;
}

export async function listStyles(scope: Pick<PresentationScope, 'workspaceId'>, signal?: AbortSignal): Promise<PresentationStyle[]> {
  const styles: PresentationStyle[] = [];
  let after: string | undefined;

  do {
    const page = await listStyleRecords(scope, after, 100, signal);

    for (let start = 0; start < page.items.length; start += 4) {
      styles.push(...await Promise.all(page.items.slice(start, start + 4).map(async (item) => {
        const record = await readArtifact<ReviewedStyle>(scope, item.id, item.version, signal);

        return reviewedStyleToStyle(record.content, record.origin !== 'reviewed_style');
      })));
    }

    after = page.nextCursor ?? undefined;
  } while (after);

  return styles;
}

/** Finds a saved deck for this page using captured source identities, even after page edits. */
async function restorePageDeck(scope: PresentationScope, selected: VersionedId | null | undefined, signal?: AbortSignal) {
  let after: string | undefined;
  let latest: ArtifactSummary | undefined;

  do {
    const page = await listDecks(scope, after, 100, signal, scope.pageId);
    const preferred = page.items.find((item) => item.id === selected?.id);

    if (preferred) return loadSavedDeck(scope, preferred.id, preferred.version, signal);
    for (const item of page.items) {
      if (!latest || item.createdAt > latest.createdAt) latest = item;
    }

    after = page.nextCursor ?? undefined;
  } while (after);

  return latest ? loadSavedDeck(scope, latest.id, latest.version, signal) : undefined;
}

export interface LoadedPresentation {
  status: PresentationStatus; session: StoredSession | null | undefined; warnings: string[]; styles: PresentationStyle[];
  map?: MindMap; mapArtifact?: Artifact<MindMap>; deck?: SavedDeck;
}
export async function loadPresentation(scope: PresentationScope, signal?: AbortSignal, restoreDeck = false): Promise<LoadedPresentation> {
  const warnings: string[] = [];
  const sessionRead = getSession(scope, signal).catch((error: unknown) => {
    if (!(error instanceof PresentationAPIError) || ![403, 404].includes(error.status)) throw error;
    warnings.push('Saved preferences reference an unavailable artifact. You can continue without restoring them.');
    // Do not invent revision zero: an inaccessible existing session cannot safely be overwritten.
    return undefined;
  });
  const [status, session, styles, mapArtifact, deck] = await Promise.all([
    getPresentationStatus(scope, signal), sessionRead, listStyles(scope, signal),
    // The saved narrative needs only the session, so it does not wait for status or styles.
    sessionRead.then(async (stored) => {
      const narrative = stored?.payload.narrative;

      if (!narrative) return undefined;
      const record = await readArtifact(scope, narrative.id, narrative.version, signal);

      return isMapArtifact(record) ? record : undefined;
    }),
    restoreDeck ? sessionRead.then((stored) => restorePageDeck(scope, stored?.payload.artifact, signal)) : undefined,
  ]);

  return { status, session, styles, warnings, map: mapArtifact?.content, mapArtifact, deck };
}

export async function importPresentationTemplate(scope: Pick<PresentationScope, 'workspaceId'>, file: File, signal?: AbortSignal): Promise<PresentationStyle> {
  const candidate = await uploadTemplate(scope, file, signal);

  return reviewedStyleToStyle(candidate.style, candidate.requiresReview, candidate.warnings);
}

export async function reviewPresentationStyle(scope: Pick<PresentationScope, 'workspaceId'>, style: PresentationStyle, signal?: AbortSignal): Promise<PresentationStyle> {
  if (!style.serverStyle || !style.serverVersion) throw new PresentationAPIError('Upload a template before reviewing it.', 'TEMPLATE_NOT_SAVED', 400);
  const record = await reviewStyle(scope, style.id, style.serverVersion, style.serverStyle, signal);

  return reviewedStyleToStyle(record.content, false, style.compatibilityWarnings);
}

export async function analyzePresentationTemplate(scope: Pick<PresentationScope, 'workspaceId'>, style: PresentationStyle, signal?: AbortSignal): Promise<PresentationStyle> {
  if (!style.serverStyle || !style.serverVersion) throw new PresentationAPIError('Upload a template before analyzing it.', 'TEMPLATE_NOT_SAVED', 400);
  const record = await analyzeTemplate(scope, style.id, style.serverVersion, signal);

  return reviewedStyleToStyle(record.content, record.origin !== 'reviewed_style', style.compatibilityWarnings);
}

export const reviewPresentationTemplate = reviewPresentationStyle;

function abortError(): DOMException { return new DOMException('The operation was aborted.', 'AbortError'); }

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }

    const onAbort = () => { clearTimeout(timer); reject(abortError()); };

    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const terminal = (job: JobStatus) => ['succeeded', 'failed', 'canceled'].includes(job.state);

/** First poll delay; later polls back off so long generations do not poll every second. */
export const JOB_POLL_INITIAL_MS = 1000;
/** Longest delay between polls of a running job. */
export const JOB_POLL_MAX_MS = 5000;

/** Polls durable status with bounded duration. Abort attempts cancellation of the known server job. */
export async function waitForJob(scope: PresentationScope, initial: JobStatus, signal?: AbortSignal, onJob?: (job: JobStatus) => void): Promise<JobStatus> {
  const session = captureTokenSession();
  const deadline = Date.now() + 10 * 60 * 1000;
  let job = initial;
  let delay = JOB_POLL_INITIAL_MS;

  try {
    for (;;) {
      if (signal?.aborted || !isTokenSessionCurrent(session)) throw abortError();
      onJob?.(job);
      if (terminal(job)) {
        if (job.state !== 'succeeded') {
          const reason = job.errorReason ?? (job.state === 'canceled' ? 'JOB_CANCELED' : 'GENERATION_FAILED');

          // A failed job reports why through its reason, such as an AI provider without credit.
          throw new PresentationAPIError(presentationErrorMessage(reason) ?? 'The presentation job did not complete.', reason, 409, false, { jobId: job.id, state: job.state });
        }

        return job;
      }

      if (Date.now() >= deadline) throw new PresentationAPIError('The job is still processing. Retry to resume this operation.', 'JOB_POLL_TIMEOUT', 0, true, { jobId: job.id });
      await pause(delay, signal);
      try {
        job = await getJob(scope, job.id, signal);
        delay = Math.min(Math.round(delay * 1.5), JOB_POLL_MAX_MS);
      } catch (error) {
        // A failed status read does not end the durable job. Keep polling it until the deadline,
        // honoring any server-requested delay; permanent errors and aborts still end the wait.
        if (!(error instanceof PresentationAPIError) || !error.retryable) throw error;
        delay = Math.min(Math.max(delay * 2, (error.retryAfterSecs ?? 0) * 1000), JOB_POLL_MAX_MS);
      }
    }
  } catch (error) {
    if (signal?.aborted && !terminal(job) && isTokenSessionCurrent(session)) {
      try { onJob?.(await cancelJob(scope, job.id)); } catch { /* Keep the durable key so a retry can recover an uncertain cancellation. */ }
    }

    throw error;
  }
}

export interface GenerationResult {
  job: JobStatus; artifact: Artifact<ServerSlidePlan | MindMap>; result: ServerSlidePlan | MindMap;
  status: PresentationStatus; deck?: SavedDeck; map?: MindMap;
}
export async function runGeneration(input: GenerateInput, signal?: AbortSignal, onJob?: (job: JobStatus) => void): Promise<GenerationResult> {
  const body = generationRequest(input, input.requestId ?? crypto.randomUUID());
  const initial = await submitGeneration(input.scope, body, signal);
  const job = await waitForJob(input.scope, initial, signal, onJob);

  return loadGenerationResult(input, job, signal);
}

/** Reads an authorized saved result without submitting a generation operation. */
export async function openReusableGeneration(input: GenerateInput, signal?: AbortSignal): Promise<GenerationResult> {
  const job = await findReusableResult(input.scope, generationRequest(input, crypto.randomUUID()), signal);

  if (!job) throw new PresentationAPIError('The source or settings changed. Generate a new result.', 'SOURCE_REVISION_CONFLICT', 409);
  return loadGenerationResult(input, job, signal);
}

async function loadGenerationResult(input: GenerateInput, job: JobStatus, signal?: AbortSignal): Promise<GenerationResult> {

  if (!job.artifactId || !job.resultVersion) throw new PresentationAPIError('The job has no saved result.', 'INVALID_JOB_RESULT', 502);
  const deckScene = job.kind === 'slides' ? sceneRead(input.scope, job.artifactId, job.resultVersion, signal) : undefined;
  const [artifact, status] = await Promise.all([
    readArtifact<ServerSlidePlan | MindMap>(input.scope, job.artifactId, job.resultVersion, signal), getPresentationStatus(input.scope, signal),
  ]);

  if ('slides' in artifact.content) {
    const scene = await (deckScene ?? getArtifactScene(input.scope, artifact.id, artifact.version, signal));
    const deck = artifactToDeck(artifact as Artifact<ServerSlidePlan>, scene, input.source, input.options);

    return { job, artifact, result: artifact.content, status, deck };
  }

  return { job, artifact, result: artifact.content, status, map: artifact.content };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
}

/** A reload within this window resubmits the same operation and replays its durable job. */
const PENDING_GENERATION_TTL_MS = 15 * 60 * 1000;
const PENDING_GENERATION_PREFIX = 'appflowy.presentation.pending-generation.';

/** Compact 53-bit string hash; storage keeps only this digest of the request, never its content. */
function digest(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);

    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function storedRequestId(key: string): string | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_GENERATION_PREFIX + digest(key)) ?? 'null') as { requestId?: unknown; savedAt?: unknown } | null;

    if (typeof value?.requestId !== 'string' || typeof value.savedAt !== 'number' || Date.now() - value.savedAt > PENDING_GENERATION_TTL_MS) return undefined;
    return value.requestId;
  } catch {
    return undefined;
  }
}

function storeRequestId(key: string, requestId: string | undefined) {
  try {
    if (requestId) sessionStorage.setItem(PENDING_GENERATION_PREFIX + digest(key), JSON.stringify({ requestId, savedAt: Date.now() }));
    else sessionStorage.removeItem(PENDING_GENERATION_PREFIX + digest(key));
  } catch {
    // Storage is a convenience; the in-memory operation still deduplicates retries in this page.
  }
}

/**
 * Retain the same operation across uncertain transport failures, including post-success reads.
 * The pending identity also survives a reload in this tab, so resubmitting the same request
 * replays the running job instead of reserving and charging a second one.
 */
export function createGenerationRunner() {
  let pending: { key: string; requestId: string; session: ReturnType<typeof captureTokenSession> } | undefined;

  return async (input: GenerateInput, signal?: AbortSignal, onJob?: (job: JobStatus) => void): Promise<GenerationResult> => {
    const key = stableJson({ workspaceId: input.scope.workspaceId, request: generationRequest(input, '') });

    if (!pending || pending.key !== key || !isTokenSessionCurrent(pending.session)) {
      pending = { key, requestId: input.requestId ?? storedRequestId(key) ?? crypto.randomUUID(), session: captureTokenSession() };
    }

    const operation = pending;
    let failedTerminal = false;
    let succeededTerminal = false;

    storeRequestId(key, operation.requestId);
    try {
      const result = await runGeneration({ ...input, requestId: operation.requestId }, signal, (job) => {
        failedTerminal ||= job.state === 'failed' || job.state === 'canceled';
        succeededTerminal ||= job.state === 'succeeded';
        onJob?.(job);
      });

      if (pending === operation) pending = undefined;
      storeRequestId(key, undefined);
      return result;
    } catch (error) {
      if (pending === operation && (failedTerminal || (!succeededTerminal && error instanceof PresentationAPIError && !error.retryable && error.status >= 400))) {
        pending = undefined;
        storeRequestId(key, undefined);
      }

      throw error;
    }
  };
}

export async function exportDeck(scope: PresentationScope, artifact: VersionedId, requestId: string, signal?: AbortSignal, onJob?: (job: JobStatus) => void) {
  const job = await waitForJob(scope, await submitExport(scope, artifact, requestId, signal), signal, onJob);
  const [file, status] = await Promise.all([downloadExport(scope, job.id, signal), getPresentationStatus(scope, signal)]);

  return { ...file, job, status };
}
