import { AxiosInstance } from 'axios';

import {
  createInitialInstance,
  getAccessToken,
  requestInterceptor,
} from '@/components/chat/lib/requets';
import {
  AIAssistantType,
  CompletionResult,
  OutputContent,
  OutputLayout,
  ResponseFormat,
  StreamType,
  View,
} from '@/components/chat/types';
import { AvailableModel } from '@/components/chat/types/ai-model';

import { extractNextJsonObject } from './stream-json-parser';

function getCompletionError(value: unknown): Error | undefined {
  if (!value || typeof value !== 'object') return;
  const data = value as Record<string, unknown>;

  // Flutter's CompletionStream handles both provider errors and AppResponse errors.
  // These may arrive in the body after HTTP 200, including after partial output.
  if (typeof data.code === 'number' && data.code !== 0) {
    const message = typeof data.message === 'string' && data.message.trim() ? data.message : 'AI request failed';

    return Object.assign(new Error(message), data, { message });
  }

  if (typeof data.error === 'string') return new Error(data.error || 'AI request failed');
}

export class WriterRequest {
  private axiosInstance: AxiosInstance = createInitialInstance();

  private readonly workspaceId: string | undefined;

  private readonly viewId: string | undefined;

  constructor(workspaceId?: string, viewId?: string, axiosInstance?: AxiosInstance) {
    this.workspaceId = workspaceId;
    this.viewId = viewId;

    if(axiosInstance) {
      this.axiosInstance = axiosInstance;
    } else {
      this.axiosInstance.interceptors.request.use(requestInterceptor);
    }
  }

  fetchAIAssistant = async(payload: {
    inputText: string;
    assistantType: AIAssistantType;
    format?: ResponseFormat;
    ragIds: string[];
    completionHistory: CompletionResult[];
    promptId?: string;
    customPrompt?: string;
    modelName?: string;
    webSearchEnabled?: boolean;
    signal?: AbortSignal;
  }, onMessage: (text: string, comment: string, done?: boolean) => void) => {
    const baseUrl = this.axiosInstance.defaults.baseURL;
    const url = `${baseUrl}/api/ai/${this.workspaceId}/v2/complete/stream`;

    const token = getAccessToken(); // Assume this function returns a valid token

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = undefined;
    let cancelled = false;

    const cancel = () => {
      cancelled = true;
      // Release the reader in the stream's finally block, after its pending read settles.
      void reader?.cancel().catch(() => undefined);
    };

    const response = await fetch(url, {
      method: 'POST',
      signal: payload.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'ai-model': payload.modelName || 'Auto',
        'x-platform': 'web-app',
      },
      body: JSON.stringify({
        text: payload.inputText,
        completion_type: payload.assistantType,
        format: payload.format || {
          output_content: OutputContent.TEXT,
          output_layout: OutputLayout.Paragraph,
        },
        metadata: {
          object_id: this.viewId,
          workspace_id: this.workspaceId,
          rag_ids: payload.ragIds.length === 0 ? [this.viewId] : payload.ragIds,
          completion_history: payload.completionHistory,
          prompt_id: payload.promptId,
          custom_prompt: payload.customPrompt ? { system: payload.customPrompt } : undefined,
          web_search_enabled: payload.webSearchEnabled,
        },
      }),
    });

    if(!response.ok) {
      const data: unknown = await response.json().catch(() => undefined);
      const error = getCompletionError(data);

      if (error) throw error;
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const streamPromise = (async() => {
      const contentType = response.headers.get('Content-Type');
      let text = '';
      let comment = '';
      let finished = false;

      const assertActive = () => {
        if (cancelled || payload.signal?.aborted) throw new DOMException('AI request cancelled', 'AbortError');
      };

      const append = (value: unknown) => {
        assertActive();
        const error = getCompletionError(value);

        if (error) throw error;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('The AI service returned an invalid response. Please try again.');
        }

        let changed = false;

        Object.entries(value).forEach(([key, content]) => {
          if (key !== StreamType.COMMENT && key !== StreamType.TEXT && key !== StreamType.IMAGE) return;
          if (typeof content !== 'string') {
            throw new Error('The AI service returned an invalid response. Please try again.');
          }

          if (key === StreamType.COMMENT) comment += content;
          else text += content;
          changed = changed || content.length > 0;
        });

        if (changed) onMessage(text, comment, false);
      };

      try {
        if (contentType?.includes('application/json')) {
          append(await response.json());
        } else {
          reader = response.body?.getReader();
          if (!reader) throw new Error('The AI service returned no content. Please try again.');
          const decoder = new TextDecoder();
          let buffer = '';
          const consumeBuffer = () => {
            while (buffer.length > 0) {
              const extracted = extractNextJsonObject(buffer);

              if (!extracted) break;
              let data: unknown;

              try {
                data = JSON.parse(extracted.jsonStr);
              } catch {
                throw new Error('The AI service returned an invalid response. Please try again.');
              }

              buffer = buffer.slice(extracted.nextIndex);
              append(data);
            }
          };

          while (!cancelled) {
            const { done, value } = await reader.read();

            if (done) {
              finished = true;
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            consumeBuffer();
          }

          assertActive();
          buffer += decoder.decode();
          consumeBuffer();
          if (buffer.trim()) throw new Error('The AI response was interrupted. Please try again.');
        }

        assertActive();
        if(!text.trim() && !comment.trim()) {
          throw new Error('The AI service returned no content. Please try again.');
        }

        onMessage(text, comment, true);
      } finally {
        if (reader) {
          if (!finished) await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      }
    })();

    return { cancel, streamPromise };
  };
  
  async getView(viewId: string) {
    const url = `/api/workspace/${this.workspaceId}/view/${viewId}?depth=1`;

    const res = await this.axiosInstance.get<{
      code: number;
      data: View;
      message: string;
    }>(url);

    if(res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  fetchViews = async() => {
    const url = `/api/workspace/${this.workspaceId}/view/${this.workspaceId}?depth=10`;

    const res = await this.axiosInstance.get<{
      code: number;
      data: View;
      message: string;
    }>(url);

    if(res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  };

  async getModelList(): Promise<{ models: AvailableModel[] }> {
    if (!this.workspaceId) {
      return Promise.reject('workspaceId is not defined');
    }

    const url = `/api/ai/${this.workspaceId}/model/list`;
    const response = await this.axiosInstance.get<{
      code: number;
      data?: { models: AvailableModel[] };
      message?: string;
    }>(url);

    if (response?.data.code === 0 && response.data.data) {
      return response.data.data;
    }

    return Promise.reject(response?.data.message || 'Failed to load models');
  }
}
