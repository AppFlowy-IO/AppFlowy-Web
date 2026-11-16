import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode, StrictMode } from 'react';

import { Reaction } from '@/application/comment.type';
import { PublishContext } from '@/application/publish';
import { PublishService } from '@/application/services/domains';

import { useLoadReactions } from '../GlobalComment.hooks';

let mockUser = { uuid: 'user-1', name: 'First user' };
let mockViewId = 'view-1';

jest.mock('@/application/publish', () => ({
  PublishContext: jest.requireActual<typeof import('react')>('react').createContext(null),
}));
jest.mock('@/application/services/domains', () => ({
  PublishService: { getReactions: jest.fn(), addReaction: jest.fn(), removeReaction: jest.fn() },
}));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUserOptional: () => mockUser }));
jest.mock('@/components/app/useWorkspaceMemberProfile', () => ({ useCurrentUserWorkspaceAvatar: () => null }));
jest.mock('@/application/user-metadata', () => ({ getUserIconUrl: () => null }));
jest.mock('@/utils/color', () => ({ stringAvatar: () => ({}) }));
jest.mock('@/utils/emoji', () => ({ isFlagEmoji: () => false }));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function snapshot(reacted: boolean): Record<string, Reaction[]> {
  return {
    comment: [{ commentId: 'comment', reactionType: 'smile', reactUsers: reacted ? [mockUser] : [] }],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <PublishContext.Provider value={{ viewMeta: { view_id: mockViewId } } as React.ContextType<typeof PublishContext>}>
        {children}
      </PublishContext.Provider>
    </StrictMode>
  );
}

describe('published comment reaction intent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { uuid: 'user-1', name: 'First user' };
    mockViewId = 'view-1';
    jest.mocked(PublishService.getReactions).mockResolvedValue(snapshot(true));
    jest.mocked(PublishService.addReaction).mockResolvedValue(undefined);
    jest.mocked(PublishService.removeReaction).mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('removes an existing reaction on the server as well as in the optimistic UI', async () => {
    const { result } = renderHook(useLoadReactions, { wrapper });

    await waitFor(() => expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(1));
    await act(async () => result.current.toggleReaction('comment', 'smile'));

    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(0);
    expect(PublishService.removeReaction).toHaveBeenCalledWith('view-1', 'comment', 'smile');
    expect(PublishService.addReaction).not.toHaveBeenCalled();
  });

  it('keeps rapid toggle intent synchronous and serializes requests for that reaction', async () => {
    jest.mocked(PublishService.getReactions).mockResolvedValue(snapshot(false));
    const firstAdd = deferred<void>();

    jest.mocked(PublishService.addReaction).mockReturnValueOnce(firstAdd.promise);
    const { result } = renderHook(useLoadReactions, { wrapper });

    await waitFor(() => expect(result.current.reactions).not.toBeNull());
    let secondToggle!: Promise<void>;

    act(() => {
      void result.current.toggleReaction('comment', 'smile');
      secondToggle = result.current.toggleReaction('comment', 'smile');
    });
    await act(async () => undefined);

    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(0);
    expect(PublishService.addReaction).toHaveBeenCalledTimes(1);
    expect(PublishService.removeReaction).not.toHaveBeenCalled();

    await act(async () => {
      firstAdd.resolve();
      await secondToggle;
    });

    expect(PublishService.removeReaction).toHaveBeenCalledTimes(1);
    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(0);
  });

  it('restores the last confirmed membership when the latest request fails', async () => {
    const removal = deferred<void>();

    jest.mocked(PublishService.removeReaction).mockReturnValueOnce(removal.promise);
    const { result } = renderHook(useLoadReactions, { wrapper });

    await waitFor(() => expect(result.current.reactions).not.toBeNull());
    let toggle!: Promise<void>;

    act(() => {
      toggle = result.current.toggleReaction('comment', 'smile');
    });
    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(0);

    await act(async () => {
      removal.reject(new Error('offline'));
      await toggle;
    });

    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(1);
  });

  it('does not roll back a newer optimistic toggle when an earlier request fails', async () => {
    const removal = deferred<void>();
    const addition = deferred<void>();

    jest.mocked(PublishService.removeReaction).mockReturnValueOnce(removal.promise);
    jest.mocked(PublishService.addReaction).mockReturnValueOnce(addition.promise);
    const { result } = renderHook(useLoadReactions, { wrapper });

    await waitFor(() => expect(result.current.reactions).not.toBeNull());
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.toggleReaction('comment', 'smile');
      second = result.current.toggleReaction('comment', 'smile');
    });
    await act(async () => {
      removal.reject(new Error('offline'));
      await first;
    });

    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(1);
    expect(PublishService.addReaction).toHaveBeenCalledTimes(1);
    await act(async () => {
      addition.resolve();
      await second;
    });
    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(1);
  });

  it('ignores stale reads after the page and signed-in user change', async () => {
    const oldRead = deferred<Record<string, Reaction[]>>();

    jest
      .mocked(PublishService.getReactions)
      .mockImplementation((viewId) => (viewId === 'view-1' ? oldRead.promise : Promise.resolve(snapshot(false))));
    const { result, rerender } = renderHook(useLoadReactions, { wrapper });

    mockUser = { uuid: 'user-2', name: 'Second user' };
    mockViewId = 'view-2';
    jest.mocked(PublishService.getReactions).mockResolvedValue(snapshot(false));
    rerender();
    await waitFor(() => expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(0));
    await act(async () => {
      oldRead.resolve(snapshot(true));
    });

    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(0);
  });

  it('keeps old mutation completions and queued requests out of a new user session', async () => {
    const removal = deferred<void>();

    jest.mocked(PublishService.removeReaction).mockReturnValueOnce(removal.promise);
    const { result, rerender } = renderHook(useLoadReactions, { wrapper });

    await waitFor(() => expect(result.current.reactions).not.toBeNull());
    let oldRequests!: Promise<void>;

    act(() => {
      void result.current.toggleReaction('comment', 'smile');
      oldRequests = result.current.toggleReaction('comment', 'smile');
    });
    await waitFor(() => expect(PublishService.removeReaction).toHaveBeenCalledTimes(1));
    mockUser = { uuid: 'user-2', name: 'Second user' };
    jest.mocked(PublishService.getReactions).mockResolvedValue(snapshot(false));
    rerender();
    await waitFor(() => expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(0));
    await act(async () => result.current.toggleReaction('comment', 'smile'));
    await act(async () => {
      removal.reject(new Error('old session offline'));
      await oldRequests;
    });

    expect(PublishService.addReaction).toHaveBeenCalledTimes(1);
    expect(result.current.reactions?.comment[0].reactUsers).toEqual([expect.objectContaining({ uuid: 'user-2' })]);
  });

  it('preserves an optimistic click made before the initial read, including failure rollback', async () => {
    const read = deferred<Record<string, Reaction[]>>();
    const addition = deferred<void>();

    jest.mocked(PublishService.getReactions).mockReturnValue(read.promise);
    jest.mocked(PublishService.addReaction).mockReturnValueOnce(addition.promise);
    const { result } = renderHook(useLoadReactions, { wrapper });
    let toggle!: Promise<void>;

    act(() => {
      toggle = result.current.toggleReaction('comment', 'smile');
    });
    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(1);
    expect(PublishService.addReaction).not.toHaveBeenCalled();
    await act(async () => {
      read.resolve(snapshot(true));
    });
    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(1);
    await act(async () => {
      addition.reject(new Error('offline'));
      await toggle;
    });

    // The server baseline already contained the user; the failed add must not remove them.
    expect(result.current.reactions?.comment[0].reactUsers).toHaveLength(1);
  });
});
