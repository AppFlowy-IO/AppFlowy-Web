import type { DatabaseContextState } from '@/application/database-yjs';
import type {
  getOrCreateDatabaseHistoryManager,
  runDatabaseAction,
  runDatabaseRowAction,
} from '@/application/database-yjs/history';

export type DatabaseTestHistory = {
  getOrCreateDatabaseHistoryManager: typeof getOrCreateDatabaseHistoryManager;
  runDatabaseAction: typeof runDatabaseAction;
  runDatabaseRowAction: typeof runDatabaseRowAction;
};

export type DatabaseTestWindow = Window & {
  __TEST_DATABASE_DOC__?: unknown;
  __TEST_DATABASE_VIEW_ID__?: string;
  __TEST_DATABASE_CONTEXT__?: DatabaseContextState;
  __TEST_DATABASE_HISTORY__?: DatabaseTestHistory;
};

const activeTestContexts = new WeakMap<DatabaseTestWindow, Map<symbol, DatabaseContextState>>();

export function exposeDatabaseTestContext(
  testWindow: DatabaseTestWindow,
  owner: symbol,
  value: DatabaseContextState,
  history?: DatabaseTestHistory
): () => void {
  const contexts = activeTestContexts.get(testWindow) ?? new Map<symbol, DatabaseContextState>();

  activeTestContexts.set(testWindow, contexts);

  contexts.delete(owner);
  contexts.set(owner, value);
  testWindow.__TEST_DATABASE_DOC__ = value.databaseDoc;
  testWindow.__TEST_DATABASE_VIEW_ID__ = value.activeViewId;
  testWindow.__TEST_DATABASE_CONTEXT__ = value;
  if (history) testWindow.__TEST_DATABASE_HISTORY__ = history;

  return () => {
    contexts.delete(owner);

    if (testWindow.__TEST_DATABASE_CONTEXT__ === value) {
      const remainingContext = Array.from(contexts.values()).at(-1);

      if (remainingContext) {
        testWindow.__TEST_DATABASE_DOC__ = remainingContext.databaseDoc;
        testWindow.__TEST_DATABASE_VIEW_ID__ = remainingContext.activeViewId;
        testWindow.__TEST_DATABASE_CONTEXT__ = remainingContext;
      } else {
        delete testWindow.__TEST_DATABASE_DOC__;
        delete testWindow.__TEST_DATABASE_VIEW_ID__;
        delete testWindow.__TEST_DATABASE_CONTEXT__;
      }
    }

    if (contexts.size === 0) {
      delete testWindow.__TEST_DATABASE_HISTORY__;
      activeTestContexts.delete(testWindow);
    }
  };
}
