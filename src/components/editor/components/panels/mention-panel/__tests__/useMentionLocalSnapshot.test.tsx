import { act, render, renderHook, screen } from '@testing-library/react';

import { View, ViewLayout } from '@/application/types';

import {
  clearMentionLocalIndex,
  EMPTY_MENTION_LOCAL_SNAPSHOT,
  recordMentionViewCreated,
  recordMentionViewOpened,
  setMentionIndexSources,
} from '../mentionLocalIndex';
import { useMentionLocalSnapshot } from '../useMentionLocalSnapshot';

const WS = 'workspace-a';

function page(viewId: string, name: string): View {
  return {
    view_id: viewId,
    name,
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
  };
}

function names(views: readonly { name: string }[]) {
  return views.map((view) => view.name);
}

describe('useMentionLocalSnapshot', () => {
  beforeEach(() => {
    clearMentionLocalIndex();
  });

  it('reads the index with no provider around it and follows its changes', () => {
    setMentionIndexSources(WS, { outline: [page('roadmap', 'Roadmap')] });

    // No wrapper: neither an AppProvider nor any other context.
    const { result } = renderHook(() => useMentionLocalSnapshot(WS));

    expect(names(result.current.views)).toEqual(['Roadmap']);

    act(() => {
      recordMentionViewCreated(WS, { viewId: 'zebra', name: 'Zebra plan', layout: ViewLayout.Document });
    });
    expect(names(result.current.views)).toEqual(['Roadmap', 'Zebra plan']);
  });

  it('gives the empty snapshot for a workspace the app has not given the index', () => {
    const { result } = renderHook(() => useMentionLocalSnapshot('published-workspace'));

    expect(result.current).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);
  });

  it('does not re-render on changes while it is given no workspace', () => {
    let renders = 0;

    setMentionIndexSources(WS, { outline: [page('roadmap', 'Roadmap')] });

    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId?: string }) => {
        renders += 1;
        return useMentionLocalSnapshot(workspaceId);
      },
      { initialProps: {} }
    );

    expect(result.current).toBe(EMPTY_MENTION_LOCAL_SNAPSHOT);

    const rendersWhileClosed = renders;

    act(() => {
      recordMentionViewOpened(WS, 'roadmap', 100);
    });
    expect(renders).toBe(rendersWhileClosed);

    rerender({ workspaceId: WS });
    expect(result.current.viewsById.get('roadmap')?.sessionOpenedAt).toBe(100);
  });

  it('renders a component outside an AppProvider', () => {
    function LocalCandidates() {
      const snapshot = useMentionLocalSnapshot(WS);

      return (
        <ul>
          {snapshot.views.map((view) => (
            <li key={view.viewId}>{view.name}</li>
          ))}
        </ul>
      );
    }

    setMentionIndexSources(WS, { outline: [page('roadmap', 'Roadmap')] });
    render(<LocalCandidates />);
    expect(screen.getByText('Roadmap')).toBeTruthy();

    act(() => {
      clearMentionLocalIndex(WS);
    });
    expect(screen.queryByText('Roadmap')).toBeNull();
  });
});
