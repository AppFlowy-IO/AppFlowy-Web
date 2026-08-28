import { useEffect, useRef } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import {
  getOrCreateDatabaseHistoryManager,
  runDatabaseAction,
  runDatabaseRowAction,
} from '@/application/database-yjs/history';
import { isDevelopmentOrTestEnvironment } from '@/utils/runtime-config';

import { exposeDatabaseTestContext, type DatabaseTestWindow } from './database-test-context';

interface DatabaseContextProviderProps {
  children: React.ReactNode;
  value: DatabaseContextState;
}

export const DatabaseContextProvider = ({ children, value }: DatabaseContextProviderProps) => {
  const testContextOwner = useRef(Symbol('database-context-provider'));

  // Expose database doc, view ID, and Yjs module for E2E testing.
  // `window.Y` is also exposed here (not only in CollaborativeEditor) so that
  // standalone database pages without an editor can still use yjs-inject-helpers.
  useEffect(() => {
    const isE2ETest = isDevelopmentOrTestEnvironment() || (typeof window !== 'undefined' && 'Cypress' in window);

    if (!isE2ETest) return;
    if (value.isDatabaseRowPage) return;
    // Skip the modal context. It sets `isDatabaseRowPage: false` but is
    // distinguished by `closeRowDetailModal`. Without this guard, opening a
    // row-detail modal would overwrite the main provider's test globals and
    // its unmount cleanup would delete them, leaving helpers without context.
    if (value.closeRowDetailModal) return;

    const testWindow = window as DatabaseTestWindow & { Y?: typeof Y };
    const owner = testContextOwner.current;

    testWindow.Y = Y;
    return exposeDatabaseTestContext(testWindow, owner, value, {
      getOrCreateDatabaseHistoryManager,
      runDatabaseAction,
      runDatabaseRowAction,
    });
  }, [value]);

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
};
