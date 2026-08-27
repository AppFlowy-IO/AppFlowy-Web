import { act, renderHook } from '@testing-library/react';
import { Awareness } from 'y-protocols/awareness';

import { useUsersSelector } from '@/application/awareness/selector';
import { AwarenessState } from '@/application/awareness/types';

jest.mock('@/application/services/domains', () => ({
  CollabService: {
    getDeviceId: () => 'local-device',
  },
}));

const createState = ({
  deviceId,
  name,
  timestamp,
  uid,
  uuid,
}: {
  deviceId: string;
  name: string;
  timestamp: number;
  uid: number;
  uuid?: string;
}): AwarenessState => ({
  version: 1,
  timestamp,
  user: {
    uid,
    device_id: deviceId,
  },
  metadata: JSON.stringify({
    user_name: name,
    cursor_color: '',
    selection_color: '',
    user_avatar: '',
    user_uuid: uuid,
  }),
});

const createAwarenessHarness = (initialStates: Array<[number, AwarenessState]>) => {
  const states = new Map(initialStates);
  const changeListeners = new Set<() => void>();
  const awareness = {
    getStates: () => states,
    on: (event: string, listener: () => void) => {
      if (event === 'change') changeListeners.add(listener);
    },
    off: (event: string, listener: () => void) => {
      if (event === 'change') changeListeners.delete(listener);
    },
  } as unknown as Awareness;

  return {
    awareness,
    emitChange: () => changeListeners.forEach((listener) => listener()),
    states,
  };
};

describe('useUsersSelector', () => {
  it('keeps avatar order stable when awareness timestamps change', () => {
    const alpha = createState({
      deviceId: 'device-alpha',
      name: 'Alpha',
      timestamp: 10,
      uid: 1,
      uuid: 'user-a',
    });
    const bravo = createState({
      deviceId: 'device-bravo',
      name: 'Bravo',
      timestamp: 30,
      uid: 2,
      uuid: 'user-b',
    });
    const charlie = createState({
      deviceId: 'device-charlie',
      name: 'Charlie',
      timestamp: 20,
      uid: 3,
      uuid: 'user-c',
    });
    const harness = createAwarenessHarness([
      [101, charlie],
      [102, alpha],
      [103, bravo],
    ]);
    const { result } = renderHook(() => useUsersSelector(harness.awareness));

    expect(result.current.map((user) => user.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);

    harness.states.set(101, { ...charlie, timestamp: 40 });
    harness.states.set(102, { ...alpha, timestamp: 50 });
    act(harness.emitChange);

    expect(result.current.map((user) => user.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('uses the newest state when the same user has multiple devices', () => {
    const harness = createAwarenessHarness([
      [101, createState({ deviceId: 'old-device', name: 'Old profile', timestamp: 10, uid: 1, uuid: 'user-a' })],
      [102, createState({ deviceId: 'new-device', name: 'New profile', timestamp: 20, uid: 1, uuid: 'user-a' })],
    ]);
    const { result } = renderHook(() => useUsersSelector(harness.awareness));

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      device_id: 'new-device',
      name: 'New profile',
      timestamp: 20,
    });
  });
});
