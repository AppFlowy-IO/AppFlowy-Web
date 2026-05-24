import { View } from '@/application/types';
import type { ChatSettings } from '@/components/chat/types';

export function isWorkspaceRootView(view: View | undefined): boolean {
  return Boolean(view?.extra?.is_space);
}

export function buildInitialAIChatSettings({
  parent,
  query,
  sourceIds,
}: {
  parent?: View;
  query?: string;
  sourceIds?: string[];
}): Partial<Pick<ChatSettings, 'rag_ids' | 'metadata' | 'full_workspace'>> {
  const metadata = query ? { initial_prompt: query } : undefined;

  if (isWorkspaceRootView(parent)) {
    return {
      full_workspace: true,
      rag_ids: [],
      ...(metadata ? { metadata } : {}),
    };
  }

  const uniqueSourceIds = Array.from(new Set(sourceIds || [])).filter(Boolean);

  return {
    ...(uniqueSourceIds.length > 0 ? { full_workspace: false, rag_ids: uniqueSourceIds } : {}),
    ...(metadata ? { metadata } : {}),
  };
}
