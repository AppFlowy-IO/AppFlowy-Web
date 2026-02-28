import {
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  QuickNote,
  QuickNoteEditorData,
} from '@/application/types';
import { RepeatedChatMessage } from '@/components/chat';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export async function searchWorkspace(workspaceId: string, query: string) {
  const url = `/api/search/${workspaceId}`;
  const payload = await executeAPIRequest<
    {
      object_id: string;
    }[]
  >(() =>
    getAxios()?.get<APIResponse<{ object_id: string }[]>>(url, {
      params: { query },
    })
  );

  return payload.map((item) => item.object_id);
}

export async function getChatMessages(workspaceId: string, chatId: string, limit?: number | undefined) {
  const url = `/api/chat/${workspaceId}/${chatId}/message`;

  return executeAPIRequest<RepeatedChatMessage>(() =>
    getAxios()?.get<APIResponse<RepeatedChatMessage>>(url, {
      params: { limit: limit },
    })
  );
}

export async function generateAISummaryForRow(workspaceId: string, payload: GenerateAISummaryRowPayload) {
  const url = `/api/ai/${workspaceId}/summarize_row`;

  return executeAPIRequest<{ text: string }>(() =>
    getAxios()?.post<APIResponse<{ text: string }>>(url, {
      workspace_id: workspaceId,
      data: payload,
    })
  ).then((data) => data.text);
}

export async function generateAITranslateForRow(workspaceId: string, payload: GenerateAITranslateRowPayload) {
  const url = `/api/ai/${workspaceId}/translate_row`;
  const payloadResponse = await executeAPIRequest<{
    items: {
      [key: string]: string;
    }[];
  }>(() =>
    getAxios()?.post<APIResponse<{
      items: {
        [key: string]: string;
      }[];
    }>>(url, {
      workspace_id: workspaceId,
      data: payload,
    })
  );

  return payloadResponse.items
    .map((item) => item.content)
    .filter((content) => content)
    .join(', ');
}

export async function getQuickNoteList(
  workspaceId: string,
  params: {
    offset?: number;
    limit?: number;
    searchTerm?: string;
  }
) {
  const url = `/api/workspace/${workspaceId}/quick-note`;
  const payload = await executeAPIRequest<{
    quick_notes: QuickNote[];
    has_more: boolean;
  }>(() =>
    getAxios()?.get<APIResponse<{
      quick_notes: QuickNote[];
      has_more: boolean;
    }>>(url, {
      params: {
        offset: params.offset,
        limit: params.limit,
        search_term: params.searchTerm || undefined,
      },
    })
  );

  return {
    data: payload.quick_notes,
    has_more: payload.has_more,
  };
}

export async function createQuickNote(workspaceId: string, payload: QuickNoteEditorData[]): Promise<QuickNote> {
  const url = `/api/workspace/${workspaceId}/quick-note`;

  return executeAPIRequest<QuickNote>(() =>
    getAxios()?.post<APIResponse<QuickNote>>(url, { data: payload })
  );
}

export async function updateQuickNote(workspaceId: string, noteId: string, payload: QuickNoteEditorData[]) {
  const url = `/api/workspace/${workspaceId}/quick-note/${noteId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, { data: payload })
  );
}

export async function deleteQuickNote(workspaceId: string, noteId: string) {
  const url = `/api/workspace/${workspaceId}/quick-note/${noteId}`;

  return executeAPIVoidRequest(() => getAxios()?.delete<APIResponse>(url));
}
