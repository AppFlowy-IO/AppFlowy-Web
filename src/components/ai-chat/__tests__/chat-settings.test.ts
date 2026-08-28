import { View, ViewLayout } from '@/application/types';
import { buildInitialAIChatSettings, isWorkspaceRootView } from '@/components/ai-chat/chat-settings';
import { RAG_SOURCE_OWNERS_METADATA_KEY } from '@/components/ai-chat/rag-scope';

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
  it('uses only an explicitly requested source for chats created under a workspace root', () => {
    const child = view({ view_id: 'doc-1' });
    const parent = view({
      view_id: 'space-id',
      extra: { is_space: true },
      children: [child, view({ view_id: 'doc-2' })],
    });

    expect(isWorkspaceRootView(parent)).toBe(true);
    expect(
      buildInitialAIChatSettings({
        parent,
        query: 'appflowy',
        sourceIds: ['doc-1', 'outside-scope'],
      })
    ).toEqual({
      full_workspace: false,
      rag_ids: ['doc-1'],
      metadata: { initial_prompt: 'appflowy' },
    });
  });

  it('does not add a space or any of its children by default', () => {
    const parent = view({
      view_id: 'space-id',
      extra: { is_space: true },
      children: [
        view({
          view_id: 'doc-1',
          children: [view({ view_id: 'nested-doc' })],
        }),
        view({ view_id: 'doc-2' }),
      ],
    });

    expect(buildInitialAIChatSettings({ parent })).toEqual({
      full_workspace: false,
      rag_ids: [],
    });
  });

  it('filters explicit source context to the parent page subtree', () => {
    const parent = view({
      view_id: 'page-id',
      children: [view({ view_id: 'doc-1' }), view({ view_id: 'doc-2' })],
    });

    expect(
      buildInitialAIChatSettings({
        parent,
        sourceIds: ['doc-1', 'doc-1', '', 'outside-scope', 'doc-2'],
      })
    ).toEqual({
      full_workspace: false,
      rag_ids: ['doc-1', 'doc-2'],
    });
  });

  it('uses only the parent page document children when no explicit sources are supplied', () => {
    expect(
      buildInitialAIChatSettings({
        parent: view({
          view_id: 'page-id',
          children: [
            view({
              view_id: 'child-id',
              children: [view({ view_id: 'nested-child-id' })],
            }),
            view({ view_id: 'second-child-id' }),
            view({
              view_id: 'database-id',
              layout: ViewLayout.Grid,
              children: [view({ view_id: 'database-child-id' })],
            }),
          ],
        }),
        query: 'summarize this',
      })
    ).toEqual({
      full_workspace: false,
      rag_ids: ['child-id', 'second-child-id'],
      metadata: { initial_prompt: 'summarize this' },
    });
  });

  it('keeps an opaque RAG source when its database owner is inside the complete scope', () => {
    const parent = view({
      view_id: 'page-id',
      children: [
        view({
          view_id: 'database-view-id',
          layout: ViewLayout.Grid,
          extra: { is_space: false, database_id: 'database-id' },
        }),
      ],
    });

    expect(
      buildInitialAIChatSettings({
        parent,
        query: 'explain this row',
        sources: [
          {
            ragId: 'row-id',
            ownerDatabaseId: 'database-id',
          },
          {
            ragId: 'outside-row-id',
            ownerDatabaseId: 'outside-database-id',
          },
        ],
      })
    ).toEqual({
      full_workspace: false,
      rag_ids: ['row-id'],
      metadata: {
        initial_prompt: 'explain this row',
        [RAG_SOURCE_OWNERS_METADATA_KEY]: {
          'row-id': { database_id: 'database-id' },
        },
      },
    });
  });
});
