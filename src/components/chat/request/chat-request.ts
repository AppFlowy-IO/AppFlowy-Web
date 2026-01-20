import { EditorData } from '@appflowyinc/editor';
import { AxiosInstance } from 'axios';

import {
  createInitialInstance,
  getAccessToken,
  readableStreamToAsyncIterator,
  requestInterceptor,
} from '@/components/chat/lib/requets';
import { convertToPageData } from '@/components/chat/lib/utils';
import { findView } from '@/components/chat/lib/views';
import {
  ChatMessage,
  GetChatMessagesPayload,
  RepeatedChatMessage,
  ResponseFormat,
  SendQuestionPayload,
  Suggestions,
  User, View, ViewLayout,
  ChatMessageMetadata, StreamType,
} from '@/components/chat/types';
import { ModelList } from '@/components/chat/types/ai-model';

export interface ChatSettings {
  name: string;
  rag_ids: string[];
  metadata: Record<string, unknown>;
}

export interface UpdateChatSettingsParams {
  name?: string;
  metadata?: Record<string, unknown>;
  rag_ids?: string[];
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

    if(axiosInstance) {
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

    if(data?.code === 0 && data.data) {
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
    if(!this.workspaceId || !this.chatId) {
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

    if(data?.code === 0 && data.data) {
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

    if(res?.data.code === 0) {
      const { data } = res.data;

      return data ? {
        uuid,
        email: data.email,
        name: data.name,
        avatar: data.avatar_url,
      } as User : Promise.reject('Member not found');
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

    if(res?.data.code === 0) {
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

    if(res?.data.code === 0) {
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

    if(res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  async fetchAnswerStream(payload: {
    question_id: number;
    format: ResponseFormat;
    model_name?: string;
  }, onMessage: (text: string, metadata: ChatMessageMetadata[], done?: boolean) => void) {
    const baseUrl = this.axiosInstance.defaults.baseURL;
    const url = `${baseUrl}/api/chat/${this.workspaceId}/${this.chatId}/answer/stream`;

    const token = getAccessToken(); // Assume this function returns a valid token

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = undefined;

    const cancel = () => {
      void reader?.cancel();
      reader?.releaseLock();
      console.log('Stream canceled');
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'ai-model': payload.model_name || 'Auto',
        'x-platform': 'web-app',
      },
      body: JSON.stringify({
        ...payload,
        chat_id: this.chatId,
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
      const metadata: ChatMessageMetadata[] = [];

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
                if(key === StreamType.META_DATA) {
                  if(Array.isArray(value)) {
                    metadata.push(...value);
                  }

                  return;
                }

                text += value;
              });

              onMessage(text, [], false);
            } catch(e) {
              console.error('Failed to parse JSON:', e);
            }

            buffer = buffer.slice(closeBraceIndex + 1);
          }
        }

        onMessage(text, metadata, true);

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
  }

  async saveAnswer(payload: {
    question_message_id: number;
    content: string;
    meta_data?: ChatMessageMetadata[],
  }) {
    const url = `/api/chat/${this.workspaceId}/${this.chatId}/message/answer`;

    const res = await this.axiosInstance.post<{
      code: number;
      data: ChatMessage;
      message: string;
      meta_data: ChatMessageMetadata[],
    }>(url, payload);

    if(res?.data.code === 0) {
      return res.data.data;
    }

    return Promise.reject(res?.data);
  }

  async getCurrentView() {
    const url = `/api/workspace/${this.workspaceId}/folder?depth=1&root_view_id=${this.chatId}`;

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

  async getView(viewId: string, forceRefresh = true) {
    const oldView = findView(this.folder?.children || [], viewId);

    if(!forceRefresh && oldView) {
      return oldView;
    }

    const url = `/api/workspace/${this.workspaceId}/folder?depth=1&root_view_id=${viewId}`;

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

  async fetchViews(forceRefresh = false) {
    if(this.folder && !forceRefresh) {
      return this.folder;
    }

    const url = `/api/workspace/${this.workspaceId}/folder?depth=10`;

    const res = await this.axiosInstance.get<{
      code: number;
      data: View;
      message: string;
    }>(url);

    if(res?.data.code === 0) {
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

    if(res?.data.code === 0) {
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

    if(res?.data.code === 0) {
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
      return response.data.data;
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
    }>(url, params);

    if (response?.data.code === 0) {
      return;
    }

    return Promise.reject(response?.data?.message || 'Failed to update chat settings');
  }
}
