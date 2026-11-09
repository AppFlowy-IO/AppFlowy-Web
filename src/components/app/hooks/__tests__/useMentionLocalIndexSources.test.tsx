import { renderHook } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';
import {
  clearMentionLocalIndex,
  EMPTY_MENTION_LOCAL_SNAPSHOT,
  getMentionLocalSnapshot,
  recordMentionViewOpened,
} from '@/components/editor/components/panels/mention-panel/mentionLocalIndex';

import { useMentionLocalIndexSources } from '../useMentionLocalIndexSources';

type Props = Parameters<typeof useMentionLocalIndexSources>[0];

function page(viewId: string): View {
  return {
    view_id: viewId,
    name: viewId,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
  };
}

function ids(workspaceId: string) {
  return getMentionLocalSnapshot(workspaceId).views.map((view) => view.viewId);
}

function renderSources(initialProps: Props) {
  return renderHook((props: Props) => useMentionLocalIndexSources(props), { initialProps });
}

describe('useMentionLocalIndexSources', () => {
  beforeEach(() => {
    clearMentionLocalIndex();
  });

  it('gives the workspace sources, and an outline refresh keeps what this tab recorded', () => {
    const recent = [{ ...page('a-page'), last_viewed_at: '2026-11-09T10:00:00Z' }];
    const { rerender } = renderSources({
      workspaceId: 'A',
      requesterId: 'user-1',
      outline: [page('a-page')],
      recentViews: recent,
      trashList: [page('a-trashed')],
    });

    expect(ids('A')).toEqual(['a-page']);
    expect(getMentionLocalSnapshot('A').viewsById.get('a-page')?.lastViewedAt).toBe(Date.parse('2026-11-09T10:00:00Z'));

    recordMentionViewOpened('A', 'a-page', 100);
    rerender({ workspaceId: 'A', requesterId: 'user-1', outline: [page('a-page'), page('a-new')], recentViews: recent });

    expect(ids('A')).toEqual(['a-page', 'a-new']);
    expect(getMentionLocalSnapshot('A').viewsById.get('a-page')?.sessionOpenedAt).toBe(100);
  });

  it('empties the workspace it leaves for another one', () => {
    const { rerender } = renderSources({ workspaceId: 'A', requesterId: 'user-1', outline: [page('a-page')] });

    recordMentionViewOpened('A', 'a-page', 100);
    // The new workspace's outline has not loaded yet.
    rerender({ workspaceId: 'B', requesterId: 'user-1' });

    expect(getMentionLocalSnapshot('A')).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
    expect(getMentionLocalSnapshot('B')).not.toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
    expect(ids('B')).toEqual([]);

    rerender({ workspaceId: 'B', requesterId: 'user-1', outline: [page('b-page')] });
    expect(ids('B')).toEqual(['b-page']);
  });

  it('gives a new workspace none of the sources the previous one left until the data layer replaces them', () => {
    const outline = [page('a-page')];
    // The same id in both workspaces, so a trash list given to the wrong one would show.
    const trash = [page('shared-id')];
    const { rerender } = renderSources({ workspaceId: 'A', requesterId: 'user-1', outline, trashList: trash });

    expect(ids('A')).toEqual(['a-page']);

    // `useWorkspaceData` resets the outline and the trash in an effect after the switch: the first
    // render for B still holds A's. B's recent views are tagged with their workspace already.
    const bRecent = [page('shared-id')];

    rerender({ workspaceId: 'B', requesterId: 'user-1', outline, trashList: trash, recentViews: bRecent });
    expect(getMentionLocalSnapshot('A')).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
    expect(ids('B')).toEqual(['shared-id']);

    // The reset, then B's own outline.
    rerender({ workspaceId: 'B', requesterId: 'user-1', outline: [], recentViews: bRecent });
    expect(ids('B')).toEqual(['shared-id']);
    rerender({ workspaceId: 'B', requesterId: 'user-1', outline: [page('b-page')], recentViews: bRecent });
    expect(ids('B')).toEqual(['b-page', 'shared-id']);
  });

  it('forgets this tab’s events when another account takes over, and keeps the sources', () => {
    const outline = [page('a-page')];
    const { rerender } = renderSources({ workspaceId: 'A', requesterId: 'user-1', outline });

    recordMentionViewOpened('A', 'a-page', 100);
    rerender({ workspaceId: 'A', requesterId: 'user-2', outline });

    expect(ids('A')).toEqual(['a-page']);
    expect(getMentionLocalSnapshot('A').viewsById.get('a-page')?.sessionOpenedAt).toBeUndefined();
  });

  it('empties the workspace on unmount, and gives nothing without a workspace', () => {
    const { unmount } = renderSources({ workspaceId: 'A', requesterId: 'user-1', outline: [page('a-page')] });

    unmount();
    expect(getMentionLocalSnapshot('A')).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);

    renderSources({ outline: [page('a-page')] });
    expect(getMentionLocalSnapshot('A')).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
  });
});
