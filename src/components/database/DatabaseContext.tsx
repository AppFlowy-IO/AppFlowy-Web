import { useEffect } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';

interface DatabaseContextProviderProps {
  children: React.ReactNode;
  value: DatabaseContextState;
}

export const DatabaseContextProvider = ({ children, value }: DatabaseContextProviderProps) => {
  // Expose database doc, view ID, and Yjs module for E2E testing.
  // `window.Y` is also exposed here (not only in CollaborativeEditor) so that
  // standalone database pages without an editor can still use yjs-inject-helpers.
  useEffect(() => {
    const isE2ETest =
      import.meta.env.DEV ||
      import.meta.env.MODE === 'test' ||
      (typeof window !== 'undefined' && 'Cypress' in window);

    if (!isE2ETest) return;
    if (value.isDatabaseRowPage) return;
    // Skip the modal context. It sets `isDatabaseRowPage: false` but is
    // distinguished by `closeRowDetailModal`. Without this guard, opening a
    // row-detail modal would overwrite the main provider's test globals and
    // its unmount cleanup would delete them, leaving helpers without context.
    if (value.closeRowDetailModal) return;

    const testWindow = window as Window & {
      __TEST_DATABASE_DOC__?: unknown;
      __TEST_DATABASE_VIEW_ID__?: string;
      __TEST_DATABASE_CONTEXT__?: DatabaseContextState;
      Y?: typeof Y;
    };
    const previousTestContext = {
      databaseDoc: testWindow.__TEST_DATABASE_DOC__,
      viewId: testWindow.__TEST_DATABASE_VIEW_ID__,
      context: testWindow.__TEST_DATABASE_CONTEXT__,
    };

    testWindow.__TEST_DATABASE_DOC__ = value.databaseDoc;
    testWindow.__TEST_DATABASE_VIEW_ID__ = value.activeViewId;
    testWindow.__TEST_DATABASE_CONTEXT__ = value;
    testWindow.Y = Y;

    return () => {
      if (testWindow.__TEST_DATABASE_CONTEXT__ === value) {
        if (previousTestContext.context) {
          testWindow.__TEST_DATABASE_DOC__ = previousTestContext.databaseDoc;
          testWindow.__TEST_DATABASE_VIEW_ID__ = previousTestContext.viewId;
          testWindow.__TEST_DATABASE_CONTEXT__ = previousTestContext.context;
        } else {
          delete testWindow.__TEST_DATABASE_DOC__;
          delete testWindow.__TEST_DATABASE_VIEW_ID__;
          delete testWindow.__TEST_DATABASE_CONTEXT__;
        }
      }

      // Keep Y exposed — it may be needed by other editors
    };
  }, [value]);

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
};
