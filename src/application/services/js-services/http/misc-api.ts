import {
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  QuickNote,
  QuickNoteEditorData,
} from '@/application/types';
import { RepeatedChatMessage } from '@/components/chat';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export interface SearchDocumentResponseItem {
  object_id: string;
  workspace_id: string;
  score: number;
  content: string;
  preview?: string | null;
  database_view_id?: string | null;
  database_id?: string | null;
  database_row_id?: string | null;
}

export interface SearchResult {
  object_id: string;
  content: string;
  database_view_id?: string | null;
  database_id?: string | null;
  database_row_id?: string | null;
}

export interface SearchSummary {
  content: string;
  highlights?: string;
  sources: string[];
}

export interface SearchSummaryResult {
  summaries: SearchSummary[];
}

const SEARCH_RESULT_LIMIT = 10;
const SEARCH_PREVIEW_SIZE = 80;

export async function searchWorkspaceDocuments(workspaceId: string, query: string) {
  const url = `/api/search/${workspaceId}`;

  return executeAPIRequest<SearchDocumentResponseItem[]>(() =>
    getAxios()?.get<APIResponse<SearchDocumentResponseItem[]>>(url, {
      params: { query, limit: SEARCH_RESULT_LIMIT, preview_size: SEARCH_PREVIEW_SIZE },
      headers: { 'x-request-time': Date.now().toString() },
    })
  );
}

export async function searchWorkspace(workspaceId: string, query: string) {
  const payload = await searchWorkspaceDocuments(workspaceId, query);

  return payload.map((item) => item.object_id);
}

export async function generateSearchSummary(
  workspaceId: string,
  query: string,
  searchResults: SearchDocumentResponseItem[]
) {
  const url = `/api/search/${workspaceId}/summary`;
  const search_results: SearchResult[] = searchResults
    .filter((item) => item.content)
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((item) => ({
      object_id: item.object_id,
      content: item.content,
      ...(item.database_view_id ? { database_view_id: item.database_view_id } : {}),
      ...(item.database_id ? { database_id: item.database_id } : {}),
      ...(item.database_row_id ? { database_row_id: item.database_row_id } : {}),
    }));

  if (search_results.length === 0) {
    return { summaries: [] };
  }

  const payload = {
    query,
    search_results,
    only_context: true,
  };
  const headers = { 'x-request-time': Date.now().toString() };

  try {
    return await executeAPIRequest<SearchSummaryResult>(() =>
      getAxios()?.post<APIResponse<SearchSummaryResult>>(url, payload, {
        headers,
      })
    );
  } catch {
    return executeAPIRequest<SearchSummaryResult>(() =>
      getAxios()?.get<APIResponse<SearchSummaryResult>>(url, {
        data: payload,
        headers,
      })
    );
  }
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
