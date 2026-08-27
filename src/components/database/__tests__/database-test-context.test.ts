import type { DatabaseContextState } from '@/application/database-yjs';

import { exposeDatabaseTestContext, type DatabaseTestWindow } from '../database-test-context';

function createContext(activeViewId: string): DatabaseContextState {
  return {
    activeViewId,
    databaseDoc: { activeViewId },
  } as unknown as DatabaseContextState;
}

describe('database E2E context exposure', () => {
  const testWindow = window as DatabaseTestWindow;

  afterEach(() => {
    delete testWindow.__TEST_DATABASE_CONTEXT__;
    delete testWindow.__TEST_DATABASE_DOC__;
    delete testWindow.__TEST_DATABASE_VIEW_ID__;
  });

  it('does not restore an already unmounted provider when overlapping providers unmount', () => {
    const first = createContext('first-view');
    const second = createContext('second-view');
    const cleanupFirst = exposeDatabaseTestContext(testWindow, Symbol('first'), first);
    const cleanupSecond = exposeDatabaseTestContext(testWindow, Symbol('second'), second);

    expect(testWindow.__TEST_DATABASE_CONTEXT__).toBe(second);

    cleanupFirst();
    expect(testWindow.__TEST_DATABASE_CONTEXT__).toBe(second);

    cleanupSecond();
    expect(testWindow.__TEST_DATABASE_CONTEXT__).toBeUndefined();
    expect(testWindow.__TEST_DATABASE_DOC__).toBeUndefined();
    expect(testWindow.__TEST_DATABASE_VIEW_ID__).toBeUndefined();
  });
});
