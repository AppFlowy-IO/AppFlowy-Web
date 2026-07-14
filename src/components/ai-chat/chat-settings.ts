import { View, ViewLayout } from '@/application/types';
import {
  AIChatRagSource,
  collectScopedOwnerIds,
  createRagSourceOwners,
  isRagSourceOwnerInScope,
  isSpaceView,
  RagScopeView,
  RAG_SOURCE_OWNERS_METADATA_KEY,
} from '@/components/ai-chat/rag-scope';
import type { ChatSettings } from '@/components/chat/types';

export function isWorkspaceRootView(view: View | undefined): boolean {
  return view ? isSpaceView(view) : false;
}

export function buildInitialAIChatSettings({
  parent,
  query,
  sourceIds,
  sources,
}: {
  parent?: RagScopeView;
  query?: string;
  sourceIds?: string[];
  sources?: AIChatRagSource[];
}): Partial<Pick<ChatSettings, 'rag_ids' | 'metadata' | 'full_workspace'>> {
  const defaultRagIds =
    parent && !isSpaceView(parent)
      ? parent.children
          .filter((child) => child.layout === ViewLayout.Document && !isSpaceView(child))
          .map((child) => child.view_id)
      : [];
  const requestedSources: AIChatRagSource[] | null = sources?.length
    ? sources
    : sourceIds?.length
    ? sourceIds.filter(Boolean).map((ragId) => ({ ragId, ownerViewId: ragId }))
    : null;
  const scopedOwnerIds = parent ? collectScopedOwnerIds([parent]) : new Set<string>();
  const validSources = requestedSources
    ? requestedSources.filter((source) => {
        const owners = createRagSourceOwners([source]);
        const owner = owners[source.ragId];

        return owner ? isRagSourceOwnerInScope(owner, scopedOwnerIds) : scopedOwnerIds.has(source.ragId);
      })
    : [];
  const ragIds = requestedSources
    ? Array.from(new Set(validSources.map((source) => source.ragId).filter(Boolean)))
    : defaultRagIds;
  const sourceOwners = createRagSourceOwners(validSources.filter((source) => source.ragId !== source.ownerViewId));
  const metadata = {
    ...(query ? { initial_prompt: query } : {}),
    ...(Object.keys(sourceOwners).length > 0 ? { [RAG_SOURCE_OWNERS_METADATA_KEY]: sourceOwners } : {}),
  };

  return {
    ...(parent ? { full_workspace: false, rag_ids: ragIds } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}
