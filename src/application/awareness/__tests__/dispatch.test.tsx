import { act, cleanup, renderHook } from '@testing-library/react';
import { createEditor } from 'slate';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import {
  useDispatchCursorAwareness,
  useDispatchUserAwareness,
  UserAwarenessParams,
} from '@/application/awareness/dispatch';
import { AwarenessMetadata, AwarenessState } from '@/application/awareness/types';

// The repository's lodash-es mock invokes debounce immediately. Resolve the
// installed dependency through Node so these ordering checks exercise its timer.
jest.mock('lodash-es', () => {
  const { createRequire } = jest.requireActual<typeof import('module')>('module');

  return jest.requireActual(createRequire(__filename).resolve('lodash-es'));
});

jest.mock('@/application/services/domains', () => ({ CollabService: { getDeviceId: () => 'device-one' } }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => undefined }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn() } }));

const initialProfile: UserAwarenessParams = {
  uid: 1,
  user_uuid: 'member-one',
  device_id: 'device-one',
  user_name: 'Initial member',
  cursor_color: '#111111',
  selection_color: '#222222',
  user_avatar: '',
};
const refreshedProfile = {
  ...initialProfile,
  user_name: 'Refreshed member',
  cursor_color: '#333333',
  selection_color: '#444444',
  user_avatar: '🎨',
};

describe('cursor awareness profile ownership', () => {
  const resources: { doc: Y.Doc; awareness: Awareness }[] = [];

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    cleanup();
    resources.splice(0).forEach(({ awareness, doc }) => {
      awareness.destroy();
      doc.destroy();
    });
    jest.useRealTimers();
  });

  function createPresence() {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);

    resources.push({ doc, awareness });
    return awareness;
  }

  function createHarness() {
    const awareness = createPresence();
    const editor = createEditor();

    editor.children = [{ type: 'paragraph', blockId: 'paragraph', children: [{ text: 'Selection target' }] }];
    editor.selection = { anchor: { path: [0, 0], offset: 1 }, focus: { path: [0, 0], offset: 4 } };
    const writes = jest.spyOn(awareness, 'setLocalState');
    const hook = renderHook(
      ({ awareness }) => ({
        user: useDispatchUserAwareness(awareness),
        cursor: useDispatchCursorAwareness(awareness),
      }),
      { initialProps: { awareness } }
    );

    return { awareness, editor, writes, ...hook };
  }

  function readPresence(awareness: Awareness) {
    const state = awareness.getLocalState() as AwarenessState;

    return { state, metadata: JSON.parse(state.metadata ?? '{}') as AwarenessMetadata };
  }

  it('keeps the latest published profile and the queued selection when its timer fires', () => {
    const { awareness, editor, writes, result } = createHarness();

    act(() => {
      result.current.user(initialProfile);
      result.current.cursor(initialProfile, editor);
      expect(writes).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(50);
      result.current.user(refreshedProfile);
    });
    expect(readPresence(awareness).metadata.user_avatar).toBe('🎨');
    act(() => {
      jest.advanceTimersByTime(50);
    });
    const { metadata, state } = readPresence(awareness);

    expect(metadata).toEqual({
      user_name: refreshedProfile.user_name,
      cursor_color: refreshedProfile.cursor_color,
      selection_color: refreshedProfile.selection_color,
      user_avatar: refreshedProfile.user_avatar,
      user_uuid: refreshedProfile.user_uuid,
    });
    expect(state.user).toEqual({ uid: initialProfile.uid, device_id: initialProfile.device_id });
    expect(state.selection).toEqual({ start: { path: [0], offset: 1 }, end: { path: [0], offset: 4 } });
    expect(writes).toHaveBeenCalledTimes(3);
  });

  it('keeps an explicit avatar removal while publishing the queued selection', () => {
    const { awareness, editor, result } = createHarness();

    act(() => {
      result.current.user(refreshedProfile);
      result.current.cursor(refreshedProfile, editor);
      jest.advanceTimersByTime(50);
      result.current.user({ ...refreshedProfile, user_avatar: '' });
      jest.advanceTimersByTime(50);
    });
    expect(readPresence(awareness).metadata.user_avatar).toBe('');
    expect(readPresence(awareness).state.selection).toBeDefined();
  });

  it.each([
    { label: 'account UID', identity: { uid: 2 } },
    { label: 'account UUID', identity: { user_uuid: 'member-two' } },
    { label: 'device', identity: { device_id: 'device-two' } },
  ])('discards a queued selection after the published $label changes', ({ identity }) => {
    const { awareness, editor, writes, result } = createHarness();
    const nextProfile = { ...refreshedProfile, ...identity };

    act(() => {
      result.current.user(initialProfile);
      result.current.cursor(initialProfile, editor);
      jest.advanceTimersByTime(50);
      result.current.user(nextProfile);
    });
    const published = awareness.getLocalState();

    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(awareness.getLocalState()).toEqual(published);
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('does not revive local presence cleared while a cursor update was queued', () => {
    const { awareness, editor, result } = createHarness();

    act(() => {
      result.current.user(initialProfile);
      result.current.cursor(initialProfile, editor);
      awareness.setLocalState(null);
      jest.advanceTimersByTime(100);
    });
    expect(awareness.getLocalState()).toBeNull();
  });

  it('cancels a queued cursor update when its owner unmounts', () => {
    const { awareness, editor, writes, result, unmount } = createHarness();

    act(() => {
      result.current.user(initialProfile);
      result.current.cursor(initialProfile, editor);
    });
    unmount();
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(readPresence(awareness).state.selection).toBeUndefined();
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('cancels work for the previous awareness object and publishes to its replacement', () => {
    const { awareness, editor, writes, result, rerender } = createHarness();
    const replacement = createPresence();

    act(() => {
      result.current.user(initialProfile);
      result.current.cursor(initialProfile, editor);
    });
    rerender({ awareness: replacement });
    act(() => {
      result.current.user(refreshedProfile);
      result.current.cursor(refreshedProfile, editor);
      jest.advanceTimersByTime(100);
    });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(readPresence(awareness).state.selection).toBeUndefined();
    expect(readPresence(replacement).metadata.user_avatar).toBe('🎨');
    expect(readPresence(replacement).state.selection).toBeDefined();
  });

  it('coalesces rapid selection changes without replacing a newer profile', () => {
    const { awareness, editor, writes, result } = createHarness();

    act(() => {
      result.current.user(initialProfile);
      result.current.cursor(initialProfile, editor);
      jest.advanceTimersByTime(50);
      editor.selection = { anchor: { path: [0, 0], offset: 2 }, focus: { path: [0, 0], offset: 6 } };
      result.current.cursor(initialProfile, editor);
      result.current.user(refreshedProfile);
      jest.advanceTimersByTime(99);
    });
    expect(readPresence(awareness).state.selection).toBeUndefined();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(readPresence(awareness).state.selection).toEqual({
      start: { path: [0], offset: 2 },
      end: { path: [0], offset: 6 },
    });
    expect(readPresence(awareness).metadata.user_avatar).toBe('🎨');
    expect(writes).toHaveBeenCalledTimes(3);
  });
});
