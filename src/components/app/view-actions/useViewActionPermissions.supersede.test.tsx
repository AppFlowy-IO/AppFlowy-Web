import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { AccessService } from '@/application/services/domains';
import { AccessLevel, type CollabObjectPermission, Types } from '@/application/types';
import { useAppEmbeddedDatabasePermissions } from '@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions';

const mockAxiosGet = jest.fn();
const mockEventEmitter = new EventEmitter();

// Only the transport and the token session are faked. Reads go through the real AccessService:
// an invalidation supersedes the reads in flight, and a superseded read joins one fresh read
// before it gives up.
jest.mock('@/application/services/js-services/http/core', () => ({
  getAxios: () => ({ get: (url: string, config: unknown) => mockAxiosGet(url, config) }),
  executeAPIRequest: async (request: () => Promise<{ data: { data: unknown } }>) => (await request()).data.data,
}));

jest.mock('@/application/session/token', () => ({
  captureTokenSession: () => ({ generation: 1, userId: 'user-id' }),
  isTokenSessionCurrent: () => true,
}));

jest.mock('@/application/services/domains', () => {
  const accessApi = jest.requireActual('@/application/services/js-services/http/access-api');

  return {
    AccessService: {
      getObjectPermission: accessApi.getObjectPermission,
      invalidateObjectPermissionRequests: accessApi.invalidateObjectPermissionRequests,
    },
    ViewService: { get: jest.fn() },
    WorkspaceService: { getSpacePermission: jest.fn() },
  };
});

jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => 'workspace-id',
  useEventEmitter: () => mockEventEmitter,
}));

// The permission reads the server received and has not answered yet.
const serverReads: Array<(overrides?: Partial<CollabObjectPermission>) => void> = [];
const stopListening: Array<() => void> = [];

function createDatabasePermission(overrides: Partial<CollabObjectPermission> = {}): CollabObjectPermission {
  return {
    object_id: 'database-id',
    collab_type: Types.Database,
    governing_view_id: 'view-id',
    access_level: AccessLevel.ReadAndWrite,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: false,
    ...overrides,
  };
}

async function answerServerReads(overrides?: Partial<CollabObjectPermission>) {
  await act(async () => {
    serverReads.splice(0).forEach((answer) => answer(overrides));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// What AppBusinessLayer does on the same events. It re-registers its listeners whenever a page
// modal opens or closes, so it can run after a hook that mounted earlier.
function supersedeReadsInFlight() {
  AccessService.invalidateObjectPermissionRequests('workspace-id');
}

async function renderEditableEmbeddedDatabase() {
  const hook = renderHook(() =>
    useAppEmbeddedDatabasePermissions({
      sourceViewId: 'view-id',
      sourceDatabaseId: 'database-id',
      inheritedReadOnly: false,
    })
  );

  await waitFor(() => expect(serverReads).toHaveLength(1));
  await answerServerReads();
  expect(hook.result.current.readOnly).toBe(false);
  return hook;
}

const supersedingTriggers: Array<[string, () => void, () => void]> = [
  [
    'a permission change',
    () => {
      mockEventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, supersedeReadsInFlight);
    },
    () => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    },
  ],
  [
    'coming back online',
    () => {
      window.addEventListener('online', supersedeReadsInFlight);
      stopListening.push(() => window.removeEventListener('online', supersedeReadsInFlight));
    },
    () => {
      window.dispatchEvent(new Event('online'));
    },
  ],
];

describe('useViewActionPermissions re-reads that the same event supersedes', () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockAxiosGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          serverReads.push((overrides) => resolve({ data: { code: 0, data: createDatabasePermission(overrides) } }));
        })
    );
  });

  afterEach(() => {
    stopListening.splice(0).forEach((stop) => stop());
    mockEventEmitter.removeAllListeners();
    // Leave no read in flight for the next test to join.
    supersedeReadsInFlight();
    serverReads.splice(0);
  });

  it.each(supersedingTriggers)(
    'starts the re-read after %s only once a later listener has superseded the reads in flight',
    async (_case, listenAfterHook, trigger) => {
      const { result } = await renderEditableEmbeddedDatabase();

      listenAfterHook();
      act(() => {
        trigger();
      });
      await waitFor(() => expect(serverReads).toHaveLength(1));
      await answerServerReads({ can_write: false });

      // The re-read was not superseded: one request took the downgrade, and the retry stays
      // available for a later invalidation, such as a tab return while it is in flight.
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
      expect(result.current.readOnly).toBe(true);
    }
  );

  it('takes a downgrade when one more invalidation supersedes the re-read in flight', async () => {
    const { result } = await renderEditableEmbeddedDatabase();

    mockEventEmitter.on(APP_EVENTS.PERMISSION_CHANGED, supersedeReadsInFlight);
    act(() => {
      mockEventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, {});
    });
    await waitFor(() => expect(serverReads).toHaveLength(1));

    // A tab return supersedes the re-read; it reads once more and takes that answer.
    supersedeReadsInFlight();
    await answerServerReads({ can_write: false });
    await answerServerReads({ can_write: false });

    expect(mockAxiosGet).toHaveBeenCalledTimes(3);
    expect(result.current.readOnly).toBe(true);
  });
});
