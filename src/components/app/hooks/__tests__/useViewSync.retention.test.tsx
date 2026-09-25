import EventEmitter from 'events';

import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { retainRollupSource } from '@/application/database-yjs/rollup/source-sync';
import { Types, YDocWithMeta } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';
import { useBindViewSync } from '@/components/database/hooks/useBindViewSync';

import { useViewOperations } from '../useViewOperations';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));
jest.mock('../useDatabaseIdentity', () => ({
  useDatabaseIdentity: () => ({
    resolveCollabObjectId: jest.fn(),
    getDatabaseIdForViewId: jest.fn(),
    getViewIdFromDatabaseId: jest.fn(),
  }),
}));

describe.each([
  ['app operations', () => useViewOperations().bindViewSync],
  ['database hook', useBindViewSync],
] as const)('%s retained sync ownership', (_label, useBind) => {
  function fixture(bound: boolean) {
    const doc = new Y.Doc({ guid: 'canonical-database' }) as YDocWithMeta;

    doc.object_id = doc.guid;
    doc.view_id = 'active-grid-view';
    doc._collabType = Types.Database;
    doc._syncBound = bound;
    const registerSyncContext = jest.fn(() => ({ doc }));
    const scheduleDeferredCleanup = jest.fn();
    const auth = {
      currentWorkspaceId: 'workspace',
      isAuthenticated: true,
      onChangeWorkspace: () => Promise.resolve(),
    } satisfies AuthInternalContextType;
    const sync = {
      registerSyncContext,
      scheduleDeferredCleanup,
      eventEmitter: new EventEmitter(),
      awarenessMap: {},
    } as unknown as SyncInternalContextType;
    const hook = renderHook(useBind, {
      wrapper: ({ children }) => (
        <AuthInternalContext.Provider value={auth}>
          <SyncInternalContext.Provider value={sync}>{children}</SyncInternalContext.Provider>
        </AuthInternalContext.Provider>
      ),
    });

    return { doc, hook, registerSyncContext, scheduleDeferredCleanup };
  }

  it('retains already-bound documents, releases exactly its owner, and reacquires after cleanup', () => {
    const f = fixture(true);
    const context = { bindViewSync: f.hook.result.current, scheduleDeferredCleanup: f.scheduleDeferredCleanup };

    try {
      expect(context.bindViewSync(f.doc)).toBeNull();
      expect(f.registerSyncContext).not.toHaveBeenCalled();
      const release = retainRollupSource(context, f.doc);

      expect(f.registerSyncContext).toHaveBeenCalledTimes(1);
      expect(f.doc.view_id).toBe('active-grid-view');
      release();
      release();
      expect(f.scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
      expect(f.scheduleDeferredCleanup).toHaveBeenCalledWith('canonical-database');
      const releaseAgain = retainRollupSource(context, f.doc);

      expect(f.registerSyncContext).toHaveBeenCalledTimes(2);
      releaseAgain();
      expect(f.scheduleDeferredCleanup).toHaveBeenCalledTimes(2);
    } finally {
      f.hook.unmount();
      f.doc.destroy();
    }
  });

  it('keeps one-argument page binding deduplicated', () => {
    const f = fixture(false);

    try {
      expect(f.hook.result.current(f.doc)?.doc).toBe(f.doc);
      expect(f.hook.result.current(f.doc)).toBeNull();
      expect(f.registerSyncContext).toHaveBeenCalledTimes(1);
      expect(f.doc._syncBound).toBe(true);
    } finally {
      f.hook.unmount();
      f.doc.destroy();
    }
  });

  it('allows a page to acquire its own owner after an auxiliary reader bound first', () => {
    const f = fixture(false);

    try {
      const release = retainRollupSource(
        { bindViewSync: f.hook.result.current, scheduleDeferredCleanup: f.scheduleDeferredCleanup },
        f.doc
      );

      expect(f.doc._syncBound).toBe(false);
      expect(f.hook.result.current(f.doc)?.doc).toBe(f.doc);
      expect(f.registerSyncContext).toHaveBeenCalledTimes(2);
      release();
      expect(f.scheduleDeferredCleanup).toHaveBeenCalledTimes(1);
      expect(f.doc._syncBound).toBe(true);
    } finally {
      f.hook.unmount();
      f.doc.destroy();
    }
  });
});

it('does not acquire an owner without a matching release capability', () => {
  const doc = new Y.Doc() as YDocWithMeta;
  const bindViewSync = jest.fn();

  try {
    retainRollupSource({ bindViewSync }, doc)();
    expect(bindViewSync).not.toHaveBeenCalled();
  } finally {
    doc.destroy();
  }
});
