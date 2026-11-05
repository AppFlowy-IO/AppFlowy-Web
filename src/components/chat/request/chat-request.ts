import { EditorData } from '@appflowyinc/editor';
import { AxiosInstance } from 'axios';

import {
  createInitialInstance,
  getAccessToken,
  readableStreamToAsyncIterator,
  requestInterceptor,
} from '@/components/chat/lib/requets';
import { convertToPageData } from '@/components/chat/lib/utils';
import { findAncestors, findView } from '@/components/chat/lib/views';
import {
  ChatMessageMetadata,
  ChatMessage,
  ChatSettings,
  GetChatMessagesPayload,
  RepeatedChatMessage,
  ResponseFormat,
  SendQuestionPayload,
  StreamErrorPayload,
  StreamType,
  Suggestions,
  UpdateQuestionPayload,
  User,
  View,
  ViewLayout,
} from '@/components/chat/types';
import { ModelList } from '@/components/chat/types/ai-model';

import { extractNextJsonObject } from './stream-json-parser';

export type UpdateChatSettingsParams = Partial<ChatSettings>;

const COMPLETE_VIEW_DEPTH = 50;
const COMPLETE_VIEW_BATCH_SIZE = 50;

const completeViewRequests = new WeakMap<AxiosInstance, Map<string, Promise<View>>>();

function isChatMessageMetadata(value: unknown): value is ChatMessageMetadata {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<ChatMessageMetadata>;

  return typeof source.id === 'string' && typeof source.name === 'string' && typeof source.source === 'string';
}

function encodeEmptyRagScope(params: UpdateChatSettingsParams, chatId: string): UpdateChatSettingsParams {
  if (params.full_workspace === true || params.rag_ids?.length !== 0) return params;

  // The AI search service treats an empty object filter as workspace-wide.
  // A chat view is not a document source, so its ID safely represents an
  // intentionally empty scope without exposing any workspace documents.
  return { ...params, rag_ids: [chatId] };
}

function decodeEmptyRagScope(settings: ChatSettings, chatId: string): ChatSettings {
  if (settings.rag_ids.length !== 1 || settings.rag_ids[0] !== chatId) return settings;

  return { ...settings, rag_ids: [] };
}

const STREAM_KEYS = new Set<string>(Object.values(StreamType));

class StreamRequestError extends Error implements StreamErrorPayload {
  code: number;
  httpStatus?: number;

  constructor(message: string, code: number, httpStatus?: number) {
    super(message);
    this.name = 'StreamRequestError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/**
 * The AI service writes failures that happen after the response started as a JSON
 * line `{code, message, error}` inside an otherwise successful stream.
 */
export function parseStreamError(data: unknown): StreamRequestError | null {
  if (typeof data !== 'object' || data === null) return null;

  const record = data as Record<string, unknown>;

  if (Object.keys(record).some((key) => STREAM_KEYS.has(key))) return null;

  const code = record.code;

  if (typeof code !== 'number' || code === 0) return null;

  return new StreamRequestError(errorMessageFromPayload(record) ?? `AI request failed with code ${code}`, code);
}

/** The service puts the readable text in `message`; older versions used `error`. */
function errorMessageFromPayload(record: Record<string, unknown>): string | undefined {
  if (typeof record.message === 'string' && record.message) return record.message;
  if (typeof record.error === 'string' && record.error) return record.error;

  return undefined;
}

async function readStreamErrorResponse(response: Response): Promise<Error> {
  let payload: unknown = null;

  try {
    const text = await response.text();

    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    const message = errorMessageFromPayload(record);

    if (message) {
      const code = typeof record.code === 'number' ? record.code : response.status;

      return new StreamRequestError(message, code, response.status);
    }
  }

  return new StreamRequestError(`HTTP error! status: ${response.status}`, response.status, response.status);
}

function collectTruncatedViewIds(root: View): string[] {
  const ids: string[] = [];
  const stack = [{ view: root, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current) continue;
    const { view, depth } = current;

    if (
      view.children.length === 0 &&
      (view.has_children === true || (view.has_children === undefined && depth >= COMPLETE_VIEW_DEPTH))
    ) {
      ids.push(view.view_id);
      continue;
    }

    view.children.forEach((child) => stack.push({ view: child, depth: depth + 1 }));
  }

  return ids;
}

function replaceViewSubtrees(root: View, replacements: ReadonlyMap<string, View>): View {
  const replacement = replacements.get(root.view_id);

  if (replacement) return replacement;
  if (root.children.length === 0) return root;

  let changed = false;
  const children = root.children.map((child) => {
    const next = replaceViewSubtrees(child, replacements);

    if (next !== child) changed = true;
    return next;
  });

  return changed ? { ...root, children } : root;
}

function normalizeContinuationRoot(view: View): View {
  // `has_children` is based on the raw folder snapshot. Shared/private children
  // can be filtered from the response, so a continuation that still has no
  // visible children is a complete terminal node for the current user. This
  // marker also terminates old-server responses that omit `has_children`.
  if (view.children.length === 0) {
    return { ...view, has_children: false };
  }

  return view;
}

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < ids.length; index += COMPLETE_VIEW_BATCH_SIZE) {
    chunks.push(ids.slice(index, index + COMPLETE_VIEW_BATCH_SIZE));
  }

  return chunks;
}

function isUnsupportedViewBatchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const value = error as {
    code?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };
  const status = value.response?.status ?? value.response?.data?.code ?? value.code;

  return status === 404 || status === 405;
}

/**
 * ChatRequest class for handling chat-related API requests
 * @class
 * @classdesc ChatRequest class manages chat interactions, particularly designed for AppFlowy cloud services.
 * It handles user information, chat messages, and member details. While primarily integrated with AppFlowy,
 * it can be customized for different backend services by implementing compatible interfaces.
 *
 * @constructor
 * @param {string} workspaceId - Unique identifier for the AppFlowy workspace
 * @param {string} chatId - Unique identifier for the specific chat instance
 * @param {AxiosInstance} [axiosInstance] - Optional custom Axios instance for HTTP requests
 *
 * @example
 * // Using with AppFlowy cloud service
 * const chatRequest = new ChatRequest(workspaceId, chatId);
 * const user = await chatRequest.getCurrentUser();
 * const messages = await chatRequest.getChatMessages();
 * const member = await chatRequest.getMember('memberId');
 *
 * @example
 * // Using with custom axios instance
 * const customAxios = axios.create({
 *   baseURL: 'your-api-url',
 *   headers: { 'Custom-Header': 'value' }
 * });
 * const chatRequest = new ChatRequest(workspaceId, chatId, customAxios);
 *
 * @property {string} workspaceId - Stored workspace identifier
 * @property {string} chatId - Stored chat identifier
 * @property {AxiosInstance} axiosInstance - HTTP client instance
 *
 * @throws {Error} If workspaceId or chatId is not provided
 * @throws {AxiosError} On API request failures
 *
 * Implementation Notes:
 * - This class is designed to work with AppFlowy's cloud services by default
 * - Developers not using AppFlowy cloud need to implement their own ChatRequest with compatible interfaces
 * - Custom axios instances can be provided for specialized request handling (e.g., custom interceptors)
 * - All API methods return Promises and should handle errors appropriately
 *
 * Configuration Notes:
 * - Default endpoint: AppFlowy cloud service
 * - Authentication: Handled by axios interceptors
 * - Rate limiting: Follows AppFlowy's API guidelines
 * - Error handling: Standardized error responses
 *
 * @see {@link https://github.com/AppFlowy-IO/AppFlowy|AppFlowy GitHub}
 * @see {@link https://docs.appflowy.io/docs/guides/appflowy-cloud|AppFlowy Cloud Documentation}
 */
export class ChatRequest {
  private axiosInstance: AxiosInstance = createInitialInstance();

  private readonly workspaceId: string | undefined;

  private readonly chatId: string | undefined;

  private folder: View | undefined;

  constructor(workspaceId?: string, chatId?: string, axiosInstance?: AxiosInstance) {
    this.workspaceId = workspaceId;
    this.chatId = chatId;

    if (axiosInstance) {
      this.axiosInstance = axiosInstance;
    } else {
      this.axiosInstance.interceptors.request.use(requestInterceptor);
    }
  }

  async getCurrentUser(): Promise<User> {
    const url = '/api/user/profile';
    const response = await this.axiosInstance.get<{
      code: number;
      data?: {
        uid: number;
        uuid: string;
        email: string;
        name: string;
        metadata: {
          icon_url: string;
        };
      };
      message: string;
    }>(url);

    const data = response?.data;

    if (data?.code === 0 && data.data) {
      const { uuid, email, name, metadata } = data.data;

      return {
        uuid,
        email,
        name,
        avatar: metadata.icon_url,
      };
    }

    return Promise.reject(data);
  }

  async getChatMessages(payload?: GetChatMessagesPayload): Promise<RepeatedChatMessage> {
    if (!this.workspaceId || !this.chatId) {
      return Promise.reject('workspaceId or chatId is not defined');
    }

    const url = `/api/chat/${this.workspaceId}/${this.chatId}/message`;

    const response = await this.axiosInstance.get<{
      code: number;
      data?: RepeatedChatMessage;
      message: string;
    }>(url, {
      params: payload,
    });

    const data = response?.data;

    if (data?.code === 0 && data.data) {
      return data.data;
    }

    return Promise.reject(data);
  }

  async getMember(uuid: string): Promise<User> {
    const url = `/api/workspace/v1/${this.workspaceId}/member/user/${uuid}`;
    const res = await this.axiosInstance.get<{
      code: number;
      data: {
        name: string;
        email: string;
        avatar_url: string;
      };
      message: string;
    }>(url);

    if (res?.data.code === 0) {
      const { data } = res.data;

      return data
        ? ({
            uuid,
            email: data.email,
            name: data.name,
            avatar: data.avatar_url,
          } as User)
        : Promise.reject('Member not found');
    }

    return Promise.reject(res?.data);
  }

  async getSuggestions(questionId: number) {
    const url = `/api/chat/${this.workspaceId}/${this.chatId}/${questionId}/related_question`;

    const res = await this.axiosInstance.get<{
      code: number;
      data: Suggestions;
      message: string;
    }>(url);

    if (res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  async updateViewName(view: View, newName: string) {
    const url = `/api/workspace/${this.workspaceId}/page-view/${view.view_id}`;

    const payload = {
      name: newName,
      icon: view.icon,
      extra: view.extra,
    };

    const res = await this.axiosInstance.patch<{
      code: number;
      message: string;
    }>(url, payload);

    if (res?.data.code === 0) {
      return;
    }

    return Promise.reject(res?.data);
  }

  async submitQuestion(payload: SendQuestionPayload) {
    const url = `/api/chat/${this.workspaceId}/${this.chatId}/message/question`;

    const res = await this.axiosInstance.post<{
      code: number;
      data: ChatMessage;
      message: string;
    }>(url, payload);

    if (res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  /**
   * Streams the answer for a question. The returned `cancel` works at any point,
   * including before response headers arrive, and a cancelled stream still reports
   * the partial text through `onMessage(..., true)` so it can be saved.
   *
   * The stream is NDJSON with one-key objects: `"1"` answer text, `"5"` progress,
   * `"6"` reasoning, `"0"` sources. An object carrying a non-zero `code` is an
   * error line and rejects `streamPromise` with it.
   */
  fetchAnswerStream(
    payload: {
      question_id: number;
      format: ResponseFormat;
      model_name?: string;
    },
    onMessage: (text: string, metadata: ChatMessageMetadata[], done?: boolean) => void,
    onProgress?: (step: string) => void,
    onReasoning?: (reasoning: string) => void
  ): { cancel: () => void; streamPromise: Promise<void> } {
    const baseUrl = this.axiosInstance.defaults.baseURL;
    const url = `${baseUrl}/api/chat/${this.workspaceId}/${this.chatId}/answer/stream`;

    const token = getAccessToken();
    const controller = new AbortController();

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = undefined;
    let cancelled = false;

    const cancel = () => {
      cancelled = true;
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    };

    const streamPromise = (async () => {
      let response: Response;

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'ai-model': payload.model_name || 'Auto',
            'x-platform': 'web-app',
          },
          body: JSON.stringify({
            ...payload,
            chat_id: this.chatId,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (cancelled || isAbortError(error)) {
          onMessage('', [], true);
          return;
        }

        throw error;
      }

      if (!response.ok) {
        throw await readStreamErrorResponse(response);
      }

      const contentType = response.headers.get('Content-Type');

      if (contentType?.includes('application/json')) {
        const json = await response.json();

        if (json.code !== 0) {
          return Promise.reject(json);
        }

        return;
      }

      reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Failed to get reader');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let reasoning = '';
      // The service may send sources before the answer (so citations resolve while
      // streaming) and again at the end; the latest list is authoritative.
      let metadata: ChatMessageMetadata[] = [];

      try {
        for await (const chunk of readableStreamToAsyncIterator(reader)) {
          buffer += decoder.decode(chunk, { stream: true });

          while (buffer.length > 0) {
            const extracted = extractNextJsonObject(buffer);

            if (!extracted) break;

            buffer = buffer.slice(extracted.nextIndex);

            let data: unknown;

            try {
              data = JSON.parse(extracted.jsonStr);
            } catch (e) {
              console.error('Failed to parse JSON:', e);
              continue;
            }

            const streamError = parseStreamError(data);

            if (streamError) {
              throw streamError;
            }

            let textChanged = false;
            let metadataChanged = false;

            Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
              switch (key) {
                case StreamType.META_DATA:
                  if (Array.isArray(value)) {
                    metadata = value.filter(isChatMessageMetadata);
                    metadataChanged = true;
                  }

                  break;
                case StreamType.PROGRESS:
                  onProgress?.(String(value));
                  break;
                case StreamType.REASONING:
                  reasoning += String(value);
                  onReasoning?.(reasoning);
                  break;
                case StreamType.TEXT:
                case StreamType.IMAGE:
                  text += String(value);
                  textChanged = true;
                  break;
                default:
                  break;
              }
            });

            if (textChanged || metadataChanged) {
              onMessage(text, metadata, false);
            }
          }
        }

        onMessage(text, metadata, true);
      } catch (error) {
        if (cancelled || isAbortError(error)) {
          // Stopping keeps whatever was already generated.
          onMessage(text, metadata, true);
          return;
        }

        throw error;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // The async iterator already released the lock.
        }

        if (!cancelled) {
          try {
            await response.body?.cancel();
          } catch (error) {
            console.error('Error canceling stream:', error);
          }
        }
      }
    })();

    return { cancel, streamPromise };
  }

  /**
   * Edits a question in place. With `generate_answer: false` the server removes the
   * old answer and returns at once so the caller can stream a fresh one.
   */
  async updateQuestion(payload: UpdateQuestionPayload): Promise<void> {
    const url = `/api/chat/${this.workspaceId}/${this.chatId}/message`;

    const res = await this.axiosInstance.put<{
      code: number;
      message: string;
    }>(url, payload);

    if (res?.data.code === 0) {
      return;
    }

    return Promise.reject(res?.data);
  }

  async saveAnswer(payload: { question_message_id: number; content: string; meta_data?: ChatMessageMetadata[] }) {
    const url = `/api/chat/${this.workspaceId}/${this.chatId}/message/answer`;

    const res = await this.axiosInstance.post<{
      code: number;
      data: ChatMessage;
      message: string;
      meta_data: ChatMessageMetadata[];
    }>(url, payload);

    if (res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  async getCurrentView() {
    const url = `/api/workspace/${this.workspaceId}/view/${this.chatId}?depth=1`;

    const res = await this.axiosInstance.get<{
      code: number;
      data: View;
      message: string;
    }>(url);

    if (res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  private async fetchViewAtDepth(viewId: string, depth: number): Promise<View> {
    if (!this.workspaceId) return Promise.reject('workspaceId is not defined');

    const url = `/api/workspace/${this.workspaceId}/view/${viewId}?depth=${depth}`;
    const res = await this.axiosInstance.get<{
      code: number;
      data: View;
      message: string;
    }>(url);

    if (res?.data.code === 0) return res.data.data;

    return Promise.reject(res?.data);
  }

  private async fetchViewBatch(viewIds: string[], depth: number): Promise<View[]> {
    if (!this.workspaceId) return Promise.reject('workspaceId is not defined');
    if (viewIds.length === 0) return [];

    const url = `/api/workspace/${this.workspaceId}/views`;
    const chunks = chunkIds(viewIds);

    try {
      const results = await Promise.all(
        chunks.map(async (ids) => {
          const params = new URLSearchParams();

          params.set('depth', String(depth));
          params.set('view_ids', ids.join(','));

          const res = await this.axiosInstance.get<{
            code: number;
            data: { views: View[] };
            message: string;
          }>(`${url}?${params.toString()}`);

          if (res?.data.code === 0) return res.data.data.views || [];

          return Promise.reject(res?.data);
        })
      );

      return results.flat();
    } catch (error) {
      if (!isUnsupportedViewBatchError(error)) throw error;

      // Servers that omit `has_children` also predate the batch route. Preserve
      // completeness by falling back to the single-view endpoint they expose.
      return Promise.all(viewIds.map((id) => this.fetchViewAtDepth(id, depth)));
    }
  }

  private async loadCompleteView(viewId: string): Promise<View> {
    let root = await this.fetchViewAtDepth(viewId, COMPLETE_VIEW_DEPTH);
    const continuedViewIds = new Set<string>();
    let truncatedViewIds = collectTruncatedViewIds(root);

    while (truncatedViewIds.length > 0) {
      if (truncatedViewIds.some((id) => continuedViewIds.has(id))) {
        throw new Error('Unable to load the complete view subtree');
      }

      truncatedViewIds.forEach((id) => continuedViewIds.add(id));
      const continuations = (await this.fetchViewBatch(truncatedViewIds, COMPLETE_VIEW_DEPTH)).map(
        normalizeContinuationRoot
      );
      const replacements = new Map(continuations.map((view) => [view.view_id, view]));

      if (truncatedViewIds.some((id) => !replacements.has(id))) {
        throw new Error('Unable to load the complete view subtree');
      }

      root = replaceViewSubtrees(root, replacements);
      truncatedViewIds = collectTruncatedViewIds(root);
    }

    return root;
  }

  async fetchCompleteView(viewId: string, forceRefresh = false): Promise<View> {
    if (!this.workspaceId) return Promise.reject('workspaceId is not defined');

    let requests = completeViewRequests.get(this.axiosInstance);

    if (!requests) {
      requests = new Map();
      completeViewRequests.set(this.axiosInstance, requests);
    }

    const cacheKey = `${this.workspaceId}:${viewId}`;
    const pending = requests.get(cacheKey);

    if (!forceRefresh && pending) return pending;

    const promise = this.loadCompleteView(viewId);

    requests.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      if (requests.get(cacheKey) === promise) {
        requests.delete(cacheKey);
      }
    }
  }

  async getViewNavigation(viewId: string): Promise<View> {
    if (!this.workspaceId) return Promise.reject('workspaceId is not defined');

    const url = `/api/workspace/${this.workspaceId}/view/${viewId}/navigation?depth=0`;
    const res = await this.axiosInstance.get<{
      code: number;
      data: View;
      message: string;
    }>(url);

    if (res?.data.code === 0) return res.data.data;

    return Promise.reject(res?.data);
  }

  async fetchCurrentChatParentScope(forceRefresh = false): Promise<View> {
    if (!this.chatId) return Promise.reject('chatId is not defined');

    const navigation = await this.getViewNavigation(this.chatId);
    const path = findAncestors([navigation], this.chatId);

    if (!path || path.length < 2) {
      throw new Error('Unable to locate the AI chat parent');
    }

    return this.fetchCompleteView(path[path.length - 2].view_id, forceRefresh);
  }

  async getView(viewId: string, forceRefresh = true) {
    const oldView = findView(this.folder?.children || [], viewId);

    if (!forceRefresh && oldView) {
      return oldView;
    }

    const url = `/api/workspace/${this.workspaceId}/view/${viewId}?depth=1`;

    const res = await this.axiosInstance.get<{
      code: number;
      data: View;
      message: string;
    }>(url);

    if (res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  async fetchViews(forceRefresh = false) {
    if (this.folder && !forceRefresh) {
      return this.folder;
    }

    const url = `/api/workspace/${this.workspaceId}/view/${this.workspaceId}?depth=10`;

    const res = await this.axiosInstance.get<{
      code: number;
      data: View;
      message: string;
    }>(url);

    if (res?.data.code === 0) {
      this.folder = res.data.data;
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  async insertContentToView(viewId: string, data: EditorData): Promise<void> {
    const url = `/api/workspace/${this.workspaceId}/page-view/${viewId}/append-block`;
    const pageData = convertToPageData(data);

    const res = await this.axiosInstance.post<{
      code: number;
      message: string;
    }>(url, {
      blocks: pageData,
    });

    if (res?.data.code === 0) {
      return;
    }

    return Promise.reject(res?.data);
  }

  async createViewWithContent(parentViewId: string, name: string, data: EditorData) {
    const url = `/api/workspace/${this.workspaceId}/page-view`;
    const pageData = {
      type: 'page',
      children: convertToPageData(data),
    };
    const res = await this.axiosInstance.post<{
      code: number;
      data: {
        view_id: string;
      };
      message: string;
    }>(url, {
      parent_view_id: parentViewId,
      page_data: pageData,
      layout: ViewLayout.Document,
      name,
    });

    if (res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  async getModelList(): Promise<ModelList> {
    if (!this.workspaceId) {
      return Promise.reject('workspaceId is not defined');
    }

    const url = `/api/ai/${this.workspaceId}/model/list`;
    const response = await this.axiosInstance.get<{
      code: number;
      data?: ModelList;
      message?: string;
    }>(url);

    if (response?.data.code === 0 && response.data.data) {
      return response.data.data;
    }

    return Promise.reject(response?.data?.message || 'Failed to fetch model list');
  }

  async getChatSettings(): Promise<ChatSettings> {
    if (!this.workspaceId || !this.chatId) {
      return Promise.reject('workspaceId or chatId is not defined');
    }

    const url = `/api/chat/${this.workspaceId}/${this.chatId}/settings`;
    const response = await this.axiosInstance.get<{
      code: number;
      data?: ChatSettings;
      message?: string;
    }>(url);

    if (response?.data.code === 0 && response.data.data) {
      return decodeEmptyRagScope(response.data.data, this.chatId);
    }

    return Promise.reject(response?.data?.message || 'Failed to fetch chat settings');
  }

  async updateChatSettings(params: UpdateChatSettingsParams): Promise<void> {
    if (!this.workspaceId || !this.chatId) {
      return Promise.reject('workspaceId or chatId is not defined');
    }

    const url = `/api/chat/${this.workspaceId}/${this.chatId}/settings`;
    const response = await this.axiosInstance.post<{
      code: number;
      message?: string;
    }>(url, encodeEmptyRagScope(params, this.chatId));

    if (response?.data.code === 0) {
      return;
    }

    return Promise.reject(response?.data?.message || 'Failed to update chat settings');
  }
}
