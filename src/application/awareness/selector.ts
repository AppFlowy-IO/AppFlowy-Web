import { uniqBy } from 'lodash-es';
import { useEffect, useMemo, useState } from 'react';
import { useSlate } from 'slate-react';
import { Awareness } from 'y-protocols/awareness';

import { CollabService } from '@/application/services/domains';
import { Log } from '@/utils/log';

import { AwarenessMetadata, AwarenessState, AwarenessUser, Cursor } from './types';
import { convertAwarenessSelection } from './utils';

// Re-export types for backward compatibility
export type { AwarenessMetadata, AwarenessSelection, AwarenessState, AwarenessUser, Cursor } from './types';

const getAwarenessIdentityKey = (uuid: string | undefined, uid: number, deviceId: string) => {
  if (uuid) {
    return `uuid:${uuid}`;
  }

  if (Number.isFinite(uid)) {
    return `uid:${uid}`;
  }

  return `device:${deviceId}`;
};

const compareAwarenessIdentities = (aIdentity: string, bIdentity: string) => {
  if (aIdentity === bIdentity) {
    return 0;
  }

  return aIdentity < bIdentity ? -1 : 1;
};

const getUniqueUsersInStableOrder = (users: AwarenessUser[]) => {
  const latestUsersByIdentity = new Map<string, AwarenessUser>();

  for (const user of users) {
    const identity = getAwarenessIdentityKey(user.uuid, user.uid, user.device_id);
    const latestUser = latestUsersByIdentity.get(identity);

    if (!latestUser || user.timestamp > latestUser.timestamp) {
      latestUsersByIdentity.set(identity, user);
    }
  }

  const namedUsers: Array<[string, AwarenessUser]> = [];

  for (const userEntry of latestUsersByIdentity.entries()) {
    if (userEntry[1].name) namedUsers.push(userEntry);
  }

  // Activity timestamps select the newest duplicate, but must not influence avatar positions.
  return namedUsers
    .sort(([aIdentity], [bIdentity]) => compareAwarenessIdentities(aIdentity, bIdentity))
    .map(([, user]) => user);
};

const getNormalizedMetadata = (rawMetadata?: string): AwarenessMetadata | null => {
  if (!rawMetadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawMetadata) as Record<string, unknown>;

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      user_name: typeof parsed.user_name === 'string' ? parsed.user_name : '',
      cursor_color: typeof parsed.cursor_color === 'string' ? parsed.cursor_color : '',
      selection_color: typeof parsed.selection_color === 'string' ? parsed.selection_color : '',
      user_avatar: typeof parsed.user_avatar === 'string' ? parsed.user_avatar : '',
      user_uuid: typeof parsed.user_uuid === 'string' ? parsed.user_uuid : undefined,
    };
  } catch (error) {
    Log.warn('Failed to parse awareness metadata', { error });
    return null;
  }
};

export function useUsersSelector(awareness?: Awareness) {
  const [users, setUsers] = useState<AwarenessUser[]>([]);

  useEffect(() => {
    const renderUsers = () => {
      const states = awareness?.getStates() as Map<number, AwarenessState>;

      const users: AwarenessUser[] = [];

      states?.forEach((state) => {
        if (!state.user) {
          return;
        }

        const uid = Number(state.user.uid);
        const meta = getNormalizedMetadata(state.metadata);

        if (!meta) {
          return;
        }

        users.push({
          uid,
          uuid: meta.user_uuid,
          name: meta.user_name,
          timestamp: state.timestamp,
          device_id: state.user.device_id,
          color: '',
          avatar: meta.user_avatar,
        });
      });

      setUsers(getUniqueUsersInStableOrder(users));
    };

    renderUsers();

    awareness?.on('change', renderUsers);
    return () => awareness?.off('change', renderUsers);
  }, [awareness]);

  return users;
}

export function useRemoteSelectionsSelector(awareness?: Awareness) {
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const editor = useSlate();
  const localDeviceId = CollabService.getDeviceId();

  useEffect(() => {
    const renderCursors = () => {
      const states = awareness?.getStates() as Map<number, AwarenessState>;
      const cursors: Cursor[] = [];
      const localClientId = awareness?.clientID;

      states?.forEach((state, clientId) => {
        if (clientId === localClientId) {
          return;
        }

        if (!state.user) {
          return;
        }

        const uid = Number(state.user.uid);
        const meta = getNormalizedMetadata(state.metadata);

        if (!meta) {
          return;
        }

        if (localDeviceId && localDeviceId === state.user.device_id) {
          return;
        }

        if (state.selection) {
          const selection = state.selection;

          cursors.push({
            uid,
            uuid: meta.user_uuid,
            name: meta.user_name,
            cursorColor: meta.cursor_color,
            selectionColor: meta.selection_color,
            selection: selection,
            deviceId: state.user.device_id,
            timestamp: state.timestamp,
          });
        } else {
          Log.debug(`🎯 No selection found for client ${clientId}`);
        }
      });

      setCursors(
        uniqBy(
          cursors.sort((a, b) => b.timestamp - a.timestamp),
          (cursor) => getAwarenessIdentityKey(cursor.uuid, cursor.uid, cursor.deviceId)
        )
      );
    };

    awareness?.on('change', renderCursors);
    return () => awareness?.off('change', renderCursors);
  }, [awareness, localDeviceId]);

  const cursorsWithBaseRange = useMemo(() => {
    if (!cursors.length || !editor || !editor.children[0]) return [];

    const result = cursors.map((cursor) => {
      const baseRange = convertAwarenessSelection(cursor.selection, editor.children);

      return {
        ...cursor,
        baseRange,
      };
    });

    Log.debug('🎯 Final cursors array:', result);
    return result;
  }, [cursors, editor]);

  return cursorsWithBaseRange;
}
