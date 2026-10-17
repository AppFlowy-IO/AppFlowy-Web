import { getBreadcrumbVerificationTarget } from '../breadcrumb';
import { View, ViewLayout } from '@/application/types';

const view = (view_id: string, layout = ViewLayout.Document, extra = {}): View => ({ view_id, layout, extra } as View);

it('uses the database title rather than the active tab for verification', () => {
  const database = view('database', ViewLayout.Grid, { is_database_container: true });
  const tab = view('grid', ViewLayout.Grid);

  expect(getBreadcrumbVerificationTarget([view('space'), database, tab])).toBe(database);
});

it('keeps row pages and ordinary documents as their own targets', () => {
  const database = view('database', ViewLayout.Grid, { is_database_container: true });
  const row = view('row');

  expect(getBreadcrumbVerificationTarget([database, row])).toBe(row);
  expect(getBreadcrumbVerificationTarget([row])).toBe(row);
  expect(getBreadcrumbVerificationTarget()).toBeUndefined();
});

it('supports a database without a container and a container opened directly', () => {
  const database = view('database', ViewLayout.Grid);

  expect(getBreadcrumbVerificationTarget([view('space'), database])).toBe(database);
  const container = view('container', ViewLayout.Grid, { is_database_container: true });

  expect(getBreadcrumbVerificationTarget([view('space'), container])).toBe(container);
});
