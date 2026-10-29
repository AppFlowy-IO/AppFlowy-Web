/** Authenticated Cloud transport. All presentation bodies are explicit allowlisted DTOs. */
import axios, { type AxiosRequestConfig } from 'axios';

import { getAxiosInstance } from '@/application/services/js-services/http';
import { captureTokenSession, isTokenSessionCurrent } from '@/application/session/token';

import type {
  Artifact, ArtifactPage, AssessmentInput, AssessmentResponse, GenerationRequest, JobStatus,
  MindMapStyle, PresentationScope, PresentationSession, PresentationStatus, ReviewedStyle,
  ServerSlidePlan, SourceEnvelope, StoredSession, TemplateCandidate, VersionedId,
} from './server-contract';
import type { DeckScene } from './server-scene';
import type { MindMap } from './types';

export type WorkspaceScope = Pick<PresentationScope, 'workspaceId'> | string;
const segment = encodeURIComponent;
const base = (scope: WorkspaceScope) => `/api/presentation/${segment(typeof scope === 'string' ? scope : scope.workspaceId)}`;

/** Cloud reason and retry details survive HTTP errors and the legacy HTTP-200 error envelope. */
export class PresentationAPIError extends Error {
  readonly name = 'PresentationAPIError';
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly details: unknown = null,
    public readonly serverCode?: number,
    public readonly retryAfterSecs?: number,
  ) { super(message); }
}

const ERROR_MESSAGES: Record<string, string> = {
  SOURCE_REVISION_CONFLICT: 'The source changed. Refresh it before continuing.',
  ARTIFACT_VERSION_CONFLICT: 'This presentation was updated elsewhere. Reload the latest version.',
  VERSION_CONFLICT: 'This item was updated elsewhere. Reload it before saving.',
  STYLE_VERSION_CONFLICT: 'The template was updated elsewhere. Reload it before saving.',
  SESSION_REVISION_CONFLICT: 'Your presentation preferences changed elsewhere. Reload before saving.',
  SLIDE_GENERATION_LIMIT: 'This workspace has no remaining slide allowance for this request.',
  PPT_EXPORT_LIMIT: 'This workspace has used its PowerPoint export allowance.',
  CUSTOM_SLIDE_COUNT: 'A paid plan is required for a custom slide count.',
  MINDMAP_STYLE: 'A paid plan is required for this mind-map style.',
  AI_RESPONSE_LIMIT: 'This workspace has reached its AI response allowance.',
  AI_ACCOUNTING_NOT_READY: 'AI usage is temporarily unavailable. Please try again shortly.',
  AI_ACCOUNTING_BUSY: 'Another operation is using this allowance. Please try again shortly.',
  PRESENTATION_PROCESSING_BUSY: 'Presentation processing is busy. Please try again shortly.',
  SOURCE_PERMISSION_DENIED: 'You no longer have permission to read one of the sources.',
  IDEMPOTENCY_CONFLICT: 'This operation ID belongs to a different request. Start a new operation.',
  // Reasons Cloud emits for conflicts, permissions and terminal job failures.
  IDEMPOTENCY_KEY_REUSED: 'This operation ID belongs to a different request. Start a new operation.',
  OPERATION_CONFLICT: 'This item changed elsewhere. Reload it before continuing.',
  SOURCE_ACCESS_DENIED: 'You no longer have permission to read one of the sources.',
  ARTIFACT_IN_USE: 'Saved presentations still use this item. Delete them before deleting it.',
  SOURCE_TOO_LARGE: 'The source is too large. Select shorter media, fewer pages or a smaller view.',
  JOB_ATTEMPTS_EXHAUSTED: 'The presentation could not be generated after several attempts. Try again later.',
  AI_EXECUTION_TIMEOUT: 'Generation took too long. Try fewer slides or a smaller source.',
  AI_MODEL_UNAVAILABLE: 'The AI model for this request is no longer available. Start a new generation.',
  AI_EXECUTION_NOT_LICENSED: 'AI features are not available on this server.',
  // AI execution reasons; Cloud sends the reason itself as the message.
  // Users can't act on the provider's billing, so it reads as an outage; the AI service log names the cause.
  AI_PROVIDER_QUOTA_EXHAUSTED: 'The AI service is unavailable right now. Please try again later.',
  AI_EXECUTION_FAILED: 'The AI service is unavailable right now. Please try again later.',
  AI_EXECUTION_BUSY: 'The AI service is busy. Please try again shortly.',
  AI_EXECUTION_UNAVAILABLE: 'The AI service is unavailable right now. Please try again shortly.',
  AI_EXECUTION_INTERRUPTED: 'The connection to the AI service was interrupted. Please try again.',
  AI_MODEL_INVALID_RESPONSE: 'The AI service returned a response that could not be read. Please try again.',
  INVALID_MODEL_OUTPUT: 'The AI returned an answer that could not be used. Please try again.',
  INVALID_MODEL_INPUT: 'The AI service is unavailable right now. Please try again later.',
  MODEL_CONTEXT_EXCEEDED: 'The source is too large for the AI model. Select fewer pages, a smaller view or shorter media.',
  MODEL_OUTPUT_TOO_LARGE: "The AI's answer was too large to use. Try fewer slides or a smaller source.",
  // Source preparation reasons that otherwise surface as raw codes in the dialog.
  RESOURCE_NOT_FOUND: 'This page or one of its sources is no longer available. Refresh and try again.',
  INCOMPLETE_SOURCE: "This page contains content presentations can't use yet, such as an unsupported database setting.",
  SOURCE_PROCESSING_BUSY: 'Source processing is busy. Please try again shortly.',
};

/** Readable text for a Cloud reason, or undefined when the reason has none. */
export function presentationErrorMessage(reason: string): string | undefined {
  return Object.hasOwn(ERROR_MESSAGES, reason) ? ERROR_MESSAGES[reason] : undefined;
}

function errorFromBody(body: unknown, status: number, retryAfter?: unknown): PresentationAPIError {
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const reason = typeof value.reason === 'string' ? value.reason
    : typeof value.message === 'string' ? value.message : 'PRESENTATION_REQUEST_FAILED';
  const delay = typeof retryAfter === 'string' ? Number(retryAfter) : undefined;

  return new PresentationAPIError(
    presentationErrorMessage(reason) ?? (typeof value.message === 'string' ? value.message : reason),
    reason, status, value.retryable === true, value.details,
    typeof value.code === 'number' ? value.code : undefined,
    delay !== undefined && Number.isFinite(delay) && delay >= 0 ? delay : undefined,
  );
}

async function bodyValue(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    try { return JSON.parse(await value.text()); } catch { return undefined; }
  }

  return value;
}

/** Uses the application's token-refresh and runtime-base client, never a local proxy/mock. */
export async function presentationRequest<T>(config: AxiosRequestConfig): Promise<T> {
  const client = getAxiosInstance();

  if (!client) throw new PresentationAPIError('Sign in before opening presentations.', 'AUTH_REQUIRED', 401);
  const session = captureTokenSession();

  try {
    const response = await client.request({ ...config, skipResponseCache: true });

    if (!isTokenSessionCurrent(session)) throw new DOMException('The signed-in session changed.', 'AbortError');
    if (config.responseType === 'blob') return response as T;
    const body = response.data;

    if (!body || body.code !== 0) throw errorFromBody(body, response.status, response.headers?.['retry-after']);
    return body.data as T;
  } catch (error) {
    if (error instanceof PresentationAPIError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    if (axios.isCancel(error)) throw new DOMException('The operation was aborted.', 'AbortError');
    if (axios.isAxiosError(error)) {
      if (error.response) throw errorFromBody(await bodyValue(error.response.data), error.response.status, error.response.headers?.['retry-after']);
      throw new PresentationAPIError('Could not reach the presentation service. Retry keeps the same operation.', 'TRANSPORT_ERROR', 0, true);
    }

    throw error;
  }
}

export const getPresentationStatus = (scope: WorkspaceScope, signal?: AbortSignal) =>
  presentationRequest<PresentationStatus>({ url: `${base(scope)}/status`, signal });
export const resolveSources = (scope: WorkspaceScope, input: AssessmentInput, signal?: AbortSignal) =>
  presentationRequest<SourceEnvelope>({ url: `${base(scope)}/sources`, method: 'POST', data: input, signal });
export const assessSources = (scope: WorkspaceScope, input: AssessmentInput, signal?: AbortSignal) =>
  presentationRequest<AssessmentResponse>({ url: `${base(scope)}/slides/assess`, method: 'POST', data: input, signal });
export const submitGeneration = (scope: WorkspaceScope, input: GenerationRequest, signal?: AbortSignal) =>
  presentationRequest<JobStatus>({ url: `${base(scope)}/generate`, method: 'POST', data: input, signal });
export const getJob = (scope: WorkspaceScope, id: string, signal?: AbortSignal) =>
  presentationRequest<JobStatus>({ url: `${base(scope)}/jobs/${segment(id)}`, signal });
export const cancelJob = (scope: WorkspaceScope, id: string, signal?: AbortSignal) =>
  presentationRequest<JobStatus>({ url: `${base(scope)}/jobs/${segment(id)}`, method: 'DELETE', signal });
export const readArtifact = <T = ServerSlidePlan | MindMap | ReviewedStyle>(scope: WorkspaceScope, id: string, version?: number, signal?: AbortSignal) =>
  presentationRequest<Artifact<T>>({ url: `${base(scope)}/artifacts/${segment(id)}`, params: { version }, signal });
export const deleteArtifact = (scope: WorkspaceScope, id: string, expectedVersion: number, signal?: AbortSignal) =>
  presentationRequest<{ deleted: true }>({ url: `${base(scope)}/artifacts/${segment(id)}`, method: 'DELETE', params: { expectedVersion }, signal });
export const listArtifactVersions = (scope: WorkspaceScope, id: string, before?: number, limit = 30, signal?: AbortSignal) =>
  presentationRequest<Artifact[]>({ url: `${base(scope)}/artifacts/${segment(id)}/versions`, params: { before, limit }, signal });
export const listArtifacts = (scope: WorkspaceScope, kind: 'deck' | 'map' | 'style', after?: string, limit = 30, signal?: AbortSignal) =>
  presentationRequest<ArtifactPage>({ url: `${base(scope)}/artifacts`, params: { kind, after, limit }, signal });
export const listDecks = (scope: WorkspaceScope, after?: string, limit = 30, signal?: AbortSignal) =>
  presentationRequest<ArtifactPage>({ url: `${base(scope)}/decks`, params: { after, limit }, signal });
export const listMaps = (scope: WorkspaceScope, after?: string, limit = 30, signal?: AbortSignal) =>
  presentationRequest<ArtifactPage>({ url: `${base(scope)}/map`, params: { after, limit }, signal });
export const listStyleRecords = (scope: WorkspaceScope, after?: string, limit = 30, signal?: AbortSignal) =>
  presentationRequest<ArtifactPage>({ url: `${base(scope)}/styles`, params: { after, limit }, signal });
export const getSession = (scope: WorkspaceScope, signal?: AbortSignal) =>
  presentationRequest<StoredSession | null>({ url: `${base(scope)}/session`, signal });
export const saveSession = (scope: WorkspaceScope, expectedRevision: number, session: PresentationSession, signal?: AbortSignal) =>
  presentationRequest<StoredSession>({ url: `${base(scope)}/session`, method: 'PUT', data: { expectedRevision, session }, signal });
export const createStructuralMap = (scope: WorkspaceScope, input: AssessmentInput, signal?: AbortSignal) =>
  presentationRequest<Artifact<MindMap>>({ url: `${base(scope)}/map/structure`, method: 'POST', data: input, signal });
export const importMap = (scope: WorkspaceScope, input: Omit<AssessmentInput, 'style'> & { id: string; map: MindMap; sourceMapping: Record<string, string>; style?: MindMapStyle }, signal?: AbortSignal) =>
  presentationRequest<Artifact<MindMap>>({ url: `${base(scope)}/map/import`, method: 'POST', data: input, signal });
export const editMap = (scope: WorkspaceScope, input: { id: string; expectedVersion: number; map: MindMap; style?: MindMapStyle }, signal?: AbortSignal) =>
  presentationRequest<Artifact<MindMap>>({ url: `${base(scope)}/map/${segment(input.id)}`, method: 'PUT', data: { expectedVersion: input.expectedVersion, map: input.map, style: input.style }, signal });
export const importDeck = (scope: WorkspaceScope, input: AssessmentInput & { id: string; deck: ServerSlidePlan }, signal?: AbortSignal) =>
  presentationRequest<Artifact<ServerSlidePlan>>({ url: `${base(scope)}/decks`, method: 'POST', data: input, signal });
export async function uploadTemplate(scope: WorkspaceScope, file: File, signal?: AbortSignal): Promise<TemplateCandidate> {
  if (file.size > 50 * 1024 * 1024) throw new PresentationAPIError('Choose a template smaller than 50 MB.', 'TEMPLATE_TOO_LARGE', 413);
  return presentationRequest({ url: `${base(scope)}/template`, method: 'POST', params: { filename: file.name }, data: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' }, signal });
}

export const reviewStyle = (scope: WorkspaceScope, id: string, expectedVersion: number, style: ReviewedStyle, signal?: AbortSignal) =>
  presentationRequest<Artifact<ReviewedStyle>>({ url: `${base(scope)}/styles/${segment(id)}/review`, method: 'PUT', data: { expectedVersion, style }, signal });
export const getArtifactScene = (scope: WorkspaceScope, id: string, version: number, signal?: AbortSignal) =>
  presentationRequest<DeckScene>({ url: `${base(scope)}/artifacts/${segment(id)}/scene`, params: { version }, signal });
export async function getArtifactAsset(scope: WorkspaceScope, id: string, version: number, assetId: string, revision: string, signal?: AbortSignal): Promise<Blob> {
  const response = await presentationRequest<{ data: Blob }>({ url: `${base(scope)}/artifacts/${segment(id)}/assets/${segment(assetId)}`,
    params: { version, revision }, responseType: 'blob', signal });

  return response.data;
}

export const submitExport = (scope: WorkspaceScope, artifact: VersionedId, requestId: string, signal?: AbortSignal) =>
  presentationRequest<JobStatus>({ url: `${base(scope)}/download`, method: 'POST', data: { requestId, artifact }, signal });
export async function downloadExport(scope: WorkspaceScope, jobId: string, signal?: AbortSignal): Promise<{ blob: Blob; fileName: string }> {
  const response = await presentationRequest<{ data: Blob; headers: Record<string, string> }>({ url: `${base(scope)}/exports/${segment(jobId)}/download`, responseType: 'blob', signal });
  const fileName = /filename="([^"\r\n]+)"/.exec(response.headers['content-disposition'] || '')?.[1] || 'presentation.pptx';

  return { blob: response.data, fileName: fileName.replace(/[/\\]/g, '_') };
}
