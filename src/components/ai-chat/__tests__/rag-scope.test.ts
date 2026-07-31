import { ViewLayout } from '@/components/chat/types/request';
import {
  areSameRagIds,
  collectScopedRagIds,
  RAG_SOURCE_OWNERS_METADATA_KEY,
  RagScopeView,
  resolveScopedRagIds,
  resolveScopedRagState,
} from '@/components/ai-chat/rag-scope';

function view(overrides: Partial<RagScopeView>): RagScopeView {
  return {
    view_id: 'view-id',
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    ...overrides,
  };
}

describe('AI chat RAG scope', () => {
  const scope = [
    view({
      view_id: 'space-id',
      extra: { is_space: true },
      children: [
        view({
          view_id: 'parent-id',
          children: [view({ view_id: 'child-id' })],
        }),
        view({ view_id: 'chat-id', layout: ViewLayout.AIChat }),
      ],
    }),
  ];

  it('collects document IDs while excluding container and chat IDs', () => {
    expect(collectScopedRagIds(scope)).toEqual(['parent-id', 'child-id']);
  });

  it('honors the authoritative top-level space marker', () => {
    const topLevelSpace = view({
      view_id: 'space-id',
      is_space: true,
      extra: null,
      children: [view({ view_id: 'document-id' })],
    });

    expect(collectScopedRagIds([topLevelSpace])).toEqual(['document-id']);
  });

  it('gives the authoritative top-level marker precedence over stale extra data', () => {
    const document = view({
      view_id: 'document-id',
      is_space: false,
      extra: { is_space: true },
    });

    expect(collectScopedRagIds([document])).toEqual(['document-id']);
  });

  it('expands full-workspace settings to the scoped document IDs', () => {
    expect(resolveScopedRagIds(scope, { full_workspace: true, rag_ids: [] })).toEqual(['parent-id', 'child-id']);
  });

  it('removes saved IDs outside the scope and duplicates', () => {
    expect(
      resolveScopedRagIds(scope, {
        full_workspace: false,
        rag_ids: ['outside-id', 'child-id', 'child-id'],
      })
    ).toEqual(['child-id']);
  });

  it('compares RAG IDs without depending on order', () => {
    expect(areSameRagIds(['parent-id', 'child-id'], ['child-id', 'parent-id'])).toBe(true);
    expect(areSameRagIds(['parent-id'], ['parent-id', 'parent-id'])).toBe(false);
    expect(areSameRagIds(['parent-id', 'parent-id'], ['parent-id', 'child-id'])).toBe(false);
  });

  it('preserves a database row source when its owner belongs to the parent scope', () => {
    const databaseScope = [
      view({
        view_id: 'parent-id',
        children: [
          view({
            view_id: 'database-view-id',
            layout: ViewLayout.Grid,
            extra: { is_space: false, database_id: 'database-id' },
          }),
        ],
      }),
    ];
    const settings = {
      full_workspace: false,
      rag_ids: ['parent-id', 'row-id'],
      metadata: {
        [RAG_SOURCE_OWNERS_METADATA_KEY]: {
          'row-id': { database_id: 'database-id' },
        },
      },
    };

    expect(resolveScopedRagState(databaseScope, settings)).toEqual({
      selectedRagIds: ['parent-id'],
      preservedRagIds: ['row-id'],
      ragIds: ['parent-id', 'row-id'],
      sourceOwners: {
        'row-id': { database_id: 'database-id' },
      },
    });
  });

  it('removes mapped sources whose owner is outside the parent scope', () => {
    expect(
      resolveScopedRagState(scope, {
        full_workspace: false,
        rag_ids: ['child-id', 'row-id'],
        metadata: {
          [RAG_SOURCE_OWNERS_METADATA_KEY]: {
            'row-id': { view_id: 'outside-database-view-id' },
          },
        },
      })
    ).toEqual({
      selectedRagIds: ['child-id'],
      preservedRagIds: [],
      ragIds: ['child-id'],
      sourceOwners: {},
    });
  });

  it('preserves opaque legacy sources but removes IDs confirmed as outside views', () => {
    const settings = {
      full_workspace: false,
      rag_ids: ['child-id', 'legacy-row-id', 'outside-view-id'],
    };

    expect(resolveScopedRagState(scope, settings, new Set(['outside-view-id']))).toEqual({
      selectedRagIds: ['child-id'],
      preservedRagIds: ['legacy-row-id'],
      ragIds: ['child-id', 'legacy-row-id'],
      sourceOwners: {},
    });
  });
});
