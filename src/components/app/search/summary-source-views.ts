import { ViewService } from '@/application/services/domains';
import type { SearchDocumentResponseItem } from '@/application/services/domains/search';
import type { View } from '@/application/types';
import { findView } from '@/components/_shared/outline/utils';
import { isSpaceView } from '@/components/ai-chat/rag-scope';

export async function loadSummarySourceViews(
  outline: View[],
  currentWorkspaceId: string,
  sourceIds: string[],
  searchResults: SearchDocumentResponseItem[] = []
): Promise<Map<string, View>> {
  const resultSourceIds = new Set(
    searchResults.flatMap((item) => [item.object_id, item.database_row_id].filter(Boolean) as string[])
  );
  const unresolvedSourceIds = Array.from(
    new Set(sourceIds.filter((sourceId) => !resultSourceIds.has(sourceId) && !findView(outline, sourceId)))
  );

  if (unresolvedSourceIds.length === 0) return new Map();

  try {
    const views = await ViewService.getMultiple(currentWorkspaceId, unresolvedSourceIds, 0);

    return new Map(views.filter((view) => !isSpaceView(view)).map((view) => [view.view_id, view]));
  } catch {
    return new Map();
  }
}
