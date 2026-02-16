import { AxiosInstance } from 'axios';

import {
  createInitialInstance,
  getAccessToken,
  readableStreamToAsyncIterator,
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
  }, onMessage: (text: string, comment: string, done?: boolean) => void) => {
    const baseUrl = this.axiosInstance.defaults.baseURL;
    const url = `${baseUrl}/api/ai/${this.workspaceId}/v2/complete/stream`;

    const token = getAccessToken(); // Assume this function returns a valid token

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = undefined;

    const cancel = () => {
      void reader?.cancel();
      reader?.releaseLock();
    };

    const response = await fetch(url, {
      method: 'POST',
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
        },
      }),
    });

    if(!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const streamPromise = (async() => {
      const contentType = response.headers.get('Content-Type');

      if(contentType?.includes('application/json')) {
        const json = await response.json();

        if(json.code !== 0) {
          return Promise.reject(json);
        }

        return;
      }

      reader = response.body?.getReader();

      if(!reader) {
        throw new Error('Failed to get reader');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let comment = '';

      try {
        for await (const chunk of readableStreamToAsyncIterator(reader)) {
          buffer += decoder.decode(chunk, { stream: true });

          while(buffer.length > 0) {
            const openBraceIndex = buffer.indexOf('{');

            if(openBraceIndex === -1) break;

            let closeBraceIndex = -1;
            let depth = 0;

            for(let i = openBraceIndex; i < buffer.length; i++) {
              if(buffer[i] === '{') depth++;
              if(buffer[i] === '}') depth--;
              if(depth === 0) {
                closeBraceIndex = i;
                break;
              }
            }

            if(closeBraceIndex === -1) break;

            const jsonStr = buffer.slice(openBraceIndex, closeBraceIndex + 1);

            try {
              const data = JSON.parse(jsonStr);

              Object.entries(data).forEach(([key, value]) => {
                if(key === StreamType.META_DATA || key === StreamType.KEEP_ALIVE_KEY) {
                  return;
                }

                if(key === StreamType.COMMENT) {
                  comment += value;
                  return;
                }

                text += value;
              });

              onMessage(text, comment, false);
            } catch(e) {
              console.error('Failed to parse JSON:', e);
            }

            buffer = buffer.slice(closeBraceIndex + 1);
          }
        }

        onMessage(text, comment, true);

      } catch(error) {
        console.error('Stream reading error:', error);
      } finally {
        reader.releaseLock();
        try {
          await response.body?.cancel();
        } catch(error) {
          console.error('Error canceling stream:', error);
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
