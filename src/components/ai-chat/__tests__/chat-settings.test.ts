import { View, ViewLayout } from '@/application/types';
import { buildInitialAIChatSettings, isWorkspaceRootView } from '@/components/ai-chat/chat-settings';

function view(overrides: Partial<View>): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

describe('AI chat initial settings', () => {
  it('uses full workspace context for chats created under a workspace root', () => {
    const parent = view({
      view_id: 'space-id',
      extra: { is_space: true },
    });

    expect(isWorkspaceRootView(parent)).toBe(true);
    expect(
      buildInitialAIChatSettings({
        parent,
        query: 'appflowy',
        sourceIds: ['doc-1', 'doc-2'],
      })
    ).toEqual({
      full_workspace: true,
      rag_ids: [],
      metadata: { initial_prompt: 'appflowy' },
    });
  });

  it('keeps explicit source context for chats created under a page', () => {
    expect(
      buildInitialAIChatSettings({
        parent: view({ view_id: 'page-id' }),
        sourceIds: ['doc-1', 'doc-1', '', 'doc-2'],
      })
    ).toEqual({
      full_workspace: false,
      rag_ids: ['doc-1', 'doc-2'],
    });
  });

  it('preserves the initial prompt without adding source context for non-root chats', () => {
    expect(
      buildInitialAIChatSettings({
        parent: view({ view_id: 'page-id' }),
        query: 'summarize this',
      })
    ).toEqual({
      metadata: { initial_prompt: 'summarize this' },
    });
  });
});
