import { useEffect, useRef } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';

interface DatabaseContextProviderProps {
  children: React.ReactNode;
  value: DatabaseContextState;
}

// Track the "primary" (first-mounted) provider instance so that modal
// providers don't clobber or prematurely delete the globals.  The primary
// provider always keeps the globals up-to-date; later providers are no-ops.
let _primaryOwner: symbol | null = null;

export const DatabaseContextProvider = ({ children, value }: DatabaseContextProviderProps) => {
  const ownerRef = useRef<symbol | null>(null);

  // Expose database doc, view ID, and Yjs module for E2E testing.
  // `window.Y` is also exposed here (not only in CollaborativeEditor) so that
  // standalone database pages without an editor can still use yjs-inject-helpers.
  useEffect(() => {
    const isE2ETest =
      import.meta.env.DEV ||
      import.meta.env.MODE === 'test' ||
      (typeof window !== 'undefined' && 'Cypress' in window);

    if (!isE2ETest) return;

    const testWindow = window as Window & {
      __TEST_DATABASE_DOC__?: unknown;
      __TEST_DATABASE_VIEW_ID__?: string;
      Y?: typeof Y;
    };

    // First provider to mount becomes the primary owner.
    // Only the primary owner writes/updates the globals.
    if (_primaryOwner === null) {
      const token = Symbol('db-test-owner');

      ownerRef.current = token;
      _primaryOwner = token;
    }

    if (ownerRef.current === _primaryOwner) {
      testWindow.__TEST_DATABASE_DOC__ = value.databaseDoc;
      testWindow.__TEST_DATABASE_VIEW_ID__ = value.activeViewId;
      testWindow.Y = Y;
    }

    return () => {
      if (ownerRef.current === _primaryOwner) {
        _primaryOwner = null;
        ownerRef.current = null;
        delete testWindow.__TEST_DATABASE_DOC__;
        delete testWindow.__TEST_DATABASE_VIEW_ID__;
        // Keep Y exposed — it may be needed by other editors
      }
    };
  }, [value.databaseDoc, value.activeViewId]);

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
};
