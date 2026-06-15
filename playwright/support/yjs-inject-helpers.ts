/**
 * Yjs Injection Helpers for E2E Tests
 *
 * Provides utilities to directly manipulate the database Yjs document,
 * simulating changes that arrive from external sources (e.g., desktop app sync).
 *
 * Requires `window.__TEST_DATABASE_DOC__`, `window.__TEST_DATABASE_VIEW_ID__`,
 * and `window.Y` to be exposed (happens automatically in dev/test mode).
 */
import { Page, expect } from '@playwright/test';

/**
 * Wait until the database Yjs test globals are available on the window.
 */
export async function waitForDatabaseDocReady(page: Page, timeout = 15000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const win = window as any;

          return !!(win.__TEST_DATABASE_DOC__ && win.__TEST_DATABASE_VIEW_ID__ && win.Y);
        }),
      { timeout, message: 'Waiting for __TEST_DATABASE_DOC__, __TEST_DATABASE_VIEW_ID__, and Y to be exposed' }
    )
    .toBe(true);
}

/**
 * Inject a text filter into the database view via Yjs transact,
 * simulating a filter arriving from a remote source (e.g., desktop sync).
 *
 * @returns The generated filter ID.
 */
export async function injectFilterViaYjs(
  page: Page,
  options: {
    fieldId: string;
    /** TextFilterCondition enum value (0=TextIs, 2=TextContains, etc.) */
    condition: number;
    content: string;
    /** FieldType enum value. Defaults to 0 (RichText). */
    fieldType?: number;
  }
): Promise<string> {
  return page.evaluate((opts) => {
    const win = window as any;
    const doc = win.__TEST_DATABASE_DOC__;
    const viewId = win.__TEST_DATABASE_VIEW_ID__;
    const Y = win.Y;

    const sharedRoot = doc.getMap('data');
    const database = sharedRoot.get('database');
    const views = database.get('views');
    const view = views.get(viewId);

    const filterId = `test_filter_${Date.now()}`;

    doc.transact(() => {
      const filters = view.get('filters');

      if (!filters) {
        throw new Error('View has no filters YArray — expected it to be pre-populated');
      }

      const filter = new Y.Map();

      filter.set('id', filterId);
      filter.set('field_id', opts.fieldId);
      filter.set('condition', opts.condition);
      filter.set('content', opts.content);
      filter.set('ty', opts.fieldType ?? 0); // FieldType.RichText
      filter.set('filter_type', 2); // FilterType.Data (And=0, Or=1, Data=2)

      filters.push([filter]);
    }, 'remote'); // Use 'remote' origin to simulate external sync

    return filterId;
  }, options);
}

/**
 * Inject a sort into the database view via Yjs transact,
 * simulating a sort arriving from a remote source (e.g., desktop sync).
 *
 * @returns The generated sort ID.
 */
export async function injectSortViaYjs(
  page: Page,
  options: {
    fieldId: string;
    /** SortCondition: 0=Ascending, 1=Descending */
    condition: number;
  }
): Promise<string> {
  return page.evaluate((opts) => {
    const win = window as any;
    const doc = win.__TEST_DATABASE_DOC__;
    const viewId = win.__TEST_DATABASE_VIEW_ID__;
    const Y = win.Y;

    const sharedRoot = doc.getMap('data');
    const database = sharedRoot.get('database');
    const views = database.get('views');
    const view = views.get(viewId);

    const sortId = `test_sort_${Date.now()}`;

    doc.transact(() => {
      const sorts = view.get('sorts');

      if (!sorts) {
        throw new Error('View has no sorts YArray — expected it to be pre-populated');
      }

      const sort = new Y.Map();

      sort.set('id', sortId);
      sort.set('field_id', opts.fieldId);
      sort.set('condition', opts.condition);

      sorts.push([sort]);
    }, 'remote'); // Use 'remote' origin to simulate external sync

    return sortId;
  }, options);
}

/**
 * Read the current filters/sorts count from the Yjs doc.
 */
export async function getYjsConditionCounts(page: Page): Promise<{ filters: number; sorts: number }> {
  return page.evaluate(() => {
    const win = window as any;
    const doc = win.__TEST_DATABASE_DOC__;
    const viewId = win.__TEST_DATABASE_VIEW_ID__;

    const sharedRoot = doc.getMap('data');
    const database = sharedRoot.get('database');
    const views = database.get('views');
    const view = views.get(viewId);

    const filters = view.get('filters');
    const sorts = view.get('sorts');

    return {
      filters: filters?.length ?? 0,
      sorts: sorts?.length ?? 0,
    };
  });
}
