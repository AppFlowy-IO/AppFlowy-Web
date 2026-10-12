import { DatabaseViewLayout } from '@/application/types';

import { validateAtomicCreationReceipt } from '../receipt';
import type {
  CreateDefaultDatabasePageRequest,
  CreateDefaultDatabaseViewRequest,
  PublishRowDocumentRequest,
} from '../types';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const restore = '00000000-0000-0000-0000-000000000000';
const linked: CreateDefaultDatabaseViewRequest = {
  schema_version: 'v1',
  request_id: id(1),
  database_restore_id: restore,
  view: {
    database_id: id(2),
    view_id: id(3),
    parent_view_id: id(4),
    source_view_id: id(5),
    name: 'Form',
    layout: DatabaseViewLayout.Form,
    embedded: false,
    responses_view_id: id(6),
    timezone_id: null,
  },
};
const linkedReceipt = {
  request_id: id(1),
  outcome: 'applied',
  result: {
    view_id: id(3),
    view_ids: [id(3), id(6)],
    database_id: id(2),
    database_restore_id: restore,
    database_version: null,
    database_update_v1: 'AQ==',
    update_batch_id: id(7),
  },
};

it('accepts the exact Form/Responses identity pair using DatabaseLayout Form=7', () => {
  expect(linked.view.layout).toBe(7);
  expect(() => validateAtomicCreationReceipt('database-view', linked, id(3), linkedReceipt)).not.toThrow();
});
it.each([
  { view_ids: [id(3)] },
  { view_ids: [id(3), id(3)] },
  { database_id: id(8) },
  { database_restore_id: id(8) },
  { database_version: 'wrong' },
  { database_update_v1: '' },
])('refuses mismatched companion/source/generation/update receipt %j', (wrong) => {
  expect(() =>
    validateAtomicCreationReceipt('database-view', linked, id(3), {
      ...linkedReceipt,
      result: { ...linkedReceipt.result, ...wrong },
    })
  ).toThrow('invalid receipt');
});
it('validates the new Database wrapper identity independently of its mounted view', () => {
  const request: CreateDefaultDatabasePageRequest = {
    schema_version: 'v1',
    request_id: id(1),
    container_id: id(2),
    parent_view_id: id(3),
    name: 'Grid',
    database: {
      database_id: id(4),
      view_id: id(5),
      name: 'Grid',
      layout: DatabaseViewLayout.Grid,
      embedded: false,
      responses_view_id: null,
      initial_row_ids: [id(6), id(7), id(8)],
      timezone_id: null,
    },
  };

  expect(() =>
    validateAtomicCreationReceipt('database', request, id(5), {
      request_id: id(1),
      outcome: 'already_applied',
      result: { view_id: id(2), database_id: id(4) },
    })
  ).not.toThrow();
  expect(() =>
    validateAtomicCreationReceipt('database', request, id(5), {
      request_id: id(1),
      outcome: 'applied',
      result: { view_id: id(5), database_id: id(4) },
    })
  ).toThrow('invalid receipt');
});
it('validates RowPage original row, derived Document, database and restore together', () => {
  const request: PublishRowDocumentRequest = {
    request_id: id(1),
    database_id: id(2),
    database_restore_id: restore,
    row_id: id(3),
    source_view_id: id(4),
    name: '',
    contribution: { kind: 'default_actions', schema_version: 'v1', actions: [] },
  };
  const receipt = {
    request_id: id(1),
    outcome: 'applied',
    result: {
      document_id: id(5),
      row_id: id(3),
      database_id: id(2),
      database_restore_id: restore,
      row_version: null,
      document_version: id(6),
      update_batch_id: id(7),
    },
  };

  expect(() => validateAtomicCreationReceipt('row-document', request, id(5), receipt)).not.toThrow();
  for (const wrong of [
    { document_id: id(8) },
    { row_id: id(8) },
    { database_id: id(8) },
    { database_restore_id: id(8) },
  ]) {
    expect(() =>
      validateAtomicCreationReceipt('row-document', request, id(5), {
        ...receipt,
        result: { ...receipt.result, ...wrong },
      })
    ).toThrow('invalid receipt');
  }
});
