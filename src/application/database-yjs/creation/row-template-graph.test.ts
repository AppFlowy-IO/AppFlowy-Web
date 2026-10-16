import { webcrypto } from 'crypto';
import { act, renderHook } from '@testing-library/react';
import { fromBase64 } from 'lib0/buffer';
import { createElement, type ReactNode } from 'react';
import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { atomicRead } from '@/application/atomic-creation';
import { collabFullSyncBatch } from '@/application/services/js-services/http/collab-api';
import { Types, YDatabase, YDatabaseCell, YDoc, YjsDatabaseKey } from '@/application/types';
import { parseYDatabaseFileMediaCellToCell, parseYDatabaseRelationCellToCell } from '../cell.parse';
import { DatabaseContext, type DatabaseContextState } from '../context';
import { CalculationType, FieldType, FilterType } from '../database.type';
import { useCalculateFieldDispatch } from '../dispatch/calculation';
import { useRemoveSort } from '../dispatch/sort-filter';
import { RelationFilterCondition } from '../fields/relation/relation.type';
import { TextFilterCondition } from '../fields/text/text.type';
import { filterBy } from '../filter';
import { useGroupsSelector } from '../selector';
import { decodeTemplateDocumentSnapshot, encodeTemplateDocumentSnapshot } from '../template/document';
import { readTimelineLayoutSetting } from '../timeline-layout';

import { decodeCreatedRowCollab } from './encoded-collab';
import { prepareTemplateRowGraph } from './row-template-graph';
import { archivedRowDocument, databaseDocument, documentBlocks } from './row-template-graph-data';
import type {
  PreparedTemplateRowGraph,
  TemplateDatabaseArchive,
  TemplateDatabaseView,
  TemplateRowGraphInput,
} from './row-template-graph-types';

jest.mock('@/application/atomic-creation', () => ({ atomicRead: jest.fn() }));
jest.mock('@/application/services/js-services/http/collab-api', () => ({ collabFullSyncBatch: jest.fn() }));

const id = (name: string) => uuidv5(name, 'bccb879f-059f-4930-9a9a-b445e21d2dba');
const zero = '00000000-0000-0000-0000-000000000000';
const read = atomicRead as jest.Mock;
const sync = collabFullSyncBatch as jest.Mock;
const docs: Y.Doc[] = [];
const keep = (doc: Y.Doc) => {
  docs.push(doc);
  return doc;
};

function document(blocks: Array<{ viewIds: string[]; databaseId: string; ty?: string }> = []): Y.Doc {
  const doc = keep(new Y.Doc());
  const body = new Y.Map<unknown>();
  const entries = new Y.Map<Y.Map<unknown>>();
  const meta = new Y.Map<unknown>();
  const children = new Y.Map<Y.Array<string>>();
  const text = new Y.Map<Y.Text>();

  doc.getMap('data').set('document', body);
  body.set('page_id', 'root');
  body.set('blocks', entries);
  body.set('meta', meta);
  meta.set('children_map', children);
  meta.set('text_map', text);
  entries.set(
    'root',
    new Y.Map(Object.entries({ id: 'root', ty: 'page', parent: '', children: 'root-children', data: '{}' }))
  );
  const order = new Y.Array<string>();

  children.set('root-children', order);
  entries.set(
    'paragraph',
    new Y.Map(
      Object.entries({
        id: 'paragraph',
        ty: 'paragraph',
        parent: 'root',
        children: '',
        data: '{}',
        external_id: 'text',
        external_type: 'text',
      })
    )
  );
  text.set('text', new Y.Text('Template text'));
  order.push(['paragraph']);
  blocks.forEach((block, index) => {
    const blockId = `database-${index}`;

    entries.set(
      blockId,
      new Y.Map(
        Object.entries({
          id: blockId,
          ty: block.ty ?? 'grid',
          parent: 'root',
          children: '',
          data: JSON.stringify({
            view_ids: block.viewIds,
            view_id: block.viewIds[0],
            database_id: block.databaseId,
            parent_id: id('template-doc'),
          }),
        })
      )
    );
    order.push([blockId]);
  });
  return doc;
}
function input(doc = document()): TemplateRowGraphInput {
  return {
    owner: {
      serverUrl: 'http://test.invalid',
      userId: id('user'),
      workspaceId: id('workspace'),
      assertCurrent: jest.fn(),
    },
    databaseId: id('parent-database'),
    restoreId: zero,
    sourceViewId: id('parent-view'),
    requestId: id('request'),
    rowId: id('new-row'),
    position: { kind: 'end' },
    positionViewIds: [id('parent-view'), id('other-parent-view')],
    rowDoc: keep(
      archivedRowDocument(
        { id: id('new-row'), cells: {} },
        undefined,
        id('new-row'),
        id('parent-database'),
        new Map(),
        []
      )
    ),
    template: {
      templateId: id('template'),
      name: 'Template',
      docViewId: id('template-doc'),
      documentData: [1],
      isDocumentEmpty: false,
      embeddedDatabases: [],
      defaultCells: {},
      createdAtMs: 0,
      updatedAtMs: 0,
    },
    documentState: Y.encodeStateAsUpdate(doc),
    signal: new AbortController().signal,
    deadline: Date.now() + 10000,
    assertCurrent: jest.fn(),
  };
}
function archive(
  databaseId = id('source-database'),
  views = [id('grid'), id('board')],
  rowCount = 2
): TemplateDatabaseArchive {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: id(`source-row-${index}`),
    database_id: databaseId,
    height: 60,
    visibility: true,
    cells: { name: { data: `Row ${index}`, field_type: 0 } },
  }));
  const settings = (viewId: string, layout: number): TemplateDatabaseView => ({
    id: viewId,
    database_id: databaseId,
    name: `View ${layout}`,
    layout,
    is_inline: false,
    embedded: true,
    created_at: 0,
    modified_at: 0,
    layout_settings: {},
    filters: [],
    sorts: [],
    group_settings: [],
    field_settings: {},
    row_orders: rows.map((row) => ({ id: row.id, height: 60 })),
    field_orders: [{ id: 'name' }],
  });

  return {
    database_id: databaseId,
    views: views.map((viewId, index) => settings(viewId, index)),
    fields: [{ id: 'name', name: 'Name', field_type: 0, is_primary: true, type_options: {} }],
    rows,
    row_metas: Object.fromEntries(rows.map((row) => [row.id, { is_document_empty: true }])),
  };
}
function snapshots(params: TemplateRowGraphInput, source: TemplateDatabaseArchive, linked = false) {
  params.template.embeddedDatabases = source.views.map((view) => ({
    sourceViewId: view.id,
    sourceDatabaseId: source.database_id,
    layoutType: view.layout === 0 ? 1 : 2,
    name: view.name,
    rawData: JSON.stringify(source),
    isLinked: linked,
  }));
}
function decode(seed: string): Y.Doc {
  const state = decodeCreatedRowCollab(seed);
  const doc = keep(new Y.Doc());

  Y.applyUpdate(doc, state.state);
  return doc;
}
function compound(result: PreparedTemplateRowGraph) {
  if (result.kind !== 'compound') throw new Error('Expected compound graph');
  return result;
}
function provideSource(source: TemplateDatabaseArchive, version?: string) {
  const mappings = new Map([
    ...source.views.map((view) => [view.id, view.id] as [string, string]),
    ...source.rows.map((row) => [String(row.id), String(row.id)] as [string, string]),
  ]);
  const doc = keep(databaseDocument(source, source.views, source.database_id, mappings));

  read.mockResolvedValue({ database_restore_id: null, version: version ?? null });
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) => ({
      objectId: item.objectId,
      collabType: item.collabType,
      missingUpdate: Y.encodeStateAsUpdate(doc),
      serverStateVector: Y.encodeStateVector(doc),
      collabVersion: version,
    }))
  );
  return doc;
}

beforeAll(() => Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }));
beforeEach(() => {
  jest.clearAllMocks();
  read.mockRejectedValue(new Error('Unexpected source read'));
  sync.mockRejectedValue(new Error('Unexpected collab read'));
});
afterEach(() => {
  docs.splice(0).forEach((doc) => doc.destroy());
});

test('plain first body uses seeded Row API and never changes prepared source state', async () => {
  const params = input();
  params.position = { kind: 'after', row_id: id('anchor') };
  const before = Y.encodeStateAsUpdate(params.rowDoc);
  const result = await prepareTemplateRowGraph(params);

  expect(result.kind).toBe('seeded');
  if (result.kind !== 'seeded') return;
  const row = decode(result.request.row.collab);

  expect((row.getMap('data').get('meta') as Y.Map<unknown>).get(uuidv5('is_document_empty', params.rowId))).toBe(false);
  expect(Y.encodeStateAsUpdate(params.rowDoc)).toEqual(before);
  expect(result.request.row.document).toBeTruthy();
  expect(result.request.position).toEqual(params.position);
  expect(result.request.position_view_ids).toEqual(params.positionViewIds);
  expect(read).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

test('owned two-tab archive creates one complete detached backing and unique row identities', async () => {
  const source = archive();
  const doc = document([{ viewIds: source.views.map((view) => view.id), databaseId: source.database_id }]);
  const params = input(doc);
  params.position = { kind: 'after', row_id: id('anchor') };

  snapshots(params, source);
  const before = Y.encodeStateAsUpdate(doc);
  const result = compound(await prepareTemplateRowGraph(params));
  const databaseDescriptor = result.manifest.objects.find((object) => object.kind === 'database')!;
  const database = decode(result.seeds.get(databaseDescriptor.object_id)!)
    .getMap('data')
    .get('database') as Y.Map<unknown>;
  const views = database.get('views') as Y.Map<Y.Map<unknown>>;
  const rowIds = result.manifest.objects
    .filter((object) => object.kind === 'database_row' && object.object_id !== params.rowId)
    .map((object) => object.object_id);

  expect(rowIds).toHaveLength(2);
  expect(views.size).toBe(3);
  expect((database.get('metas') as Y.Map<unknown>).get('iid')).toBe(
    uuidv5('inline_view_id', databaseDescriptor.object_id)
  );
  views.forEach((view) =>
    expect((view.get('row_orders') as Y.Array<{ id: string }>).toArray().map((order) => order.id)).toEqual(rowIds)
  );
  expect(result.manifest.database_extensions).toEqual([]);
  expect(result.manifest.target.position).toEqual(params.position);
  expect(result.manifest.target.position_view_ids).toEqual(params.positionViewIds);
  expect(new Set([...result.seeds.keys()]).size).toBe(5);
  expect(result.manifest.views[0].content).toMatchObject({
    kind: 'row_document',
    row_id: params.rowId,
    database_id: params.databaseId,
  });
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  expect(read).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
  for (const descriptor of result.manifest.objects) {
    const bytes = fromBase64(result.seeds.get(descriptor.object_id)!);

    expect(descriptor.byte_length).toBe(bytes.length);
    expect(descriptor.sha256).toEqual(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))));
  }
});

test('copied settings support group selection, sort removal, calculations and nested shared edits', async () => {
  const source = archive();
  const view = source.views[0];
  view.group_settings = [{ id: 'group', field_id: 'name', ty: 0, groups: [{ id: 'column', visible: true }] }];
  view.sorts = [{ id: 'sort', field_id: 'name', condition: 0 }];
  view.filters = [
    { id: 'filter', filter_type: 0, children: [{ id: 'child-filter', field_id: 'name', filter_type: 2 }] },
  ];
  source.calculations = { [view.id]: [{ id: 'count', field_id: 'name', ty: CalculationType.Count }] };
  const before = JSON.stringify(source);
  const params = input(document([{ viewIds: [view.id], databaseId: source.database_id }]));
  snapshots(params, source);
  const result = compound(await prepareTemplateRowGraph(params));
  const descriptor = result.manifest.objects.find((object) => object.kind === 'database')!;
  const doc = decode(result.seeds.get(descriptor.object_id)!) as YDoc;
  const database = doc.getMap('data').get('database') as YDatabase;
  const [viewId, copied] = [...database.get(YjsDatabaseKey.views)].find(
    ([, value]) => !value.get(YjsDatabaseKey.is_inline)
  )!;
  const context: DatabaseContextState = {
    databaseDoc: doc,
    databasePageId: viewId,
    activeViewId: viewId,
    readOnly: false,
    rowMap: {},
  };
  const hooks = renderHook(
    () => ({
      groups: useGroupsSelector(),
      removeSort: useRemoveSort(),
      calculate: useCalculateFieldDispatch('name'),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(DatabaseContext.Provider, { value: context }, children),
    }
  );
  try {
    expect(hooks.result.current.groups).toEqual(['group']);
    const columns = copied.get(YjsDatabaseKey.groups).get(0).get(YjsDatabaseKey.groups);
    const filterChildren = copied.get(YjsDatabaseKey.filters).get(0).get(YjsDatabaseKey.children) as Y.Array<
      Y.Map<unknown>
    >;
    expect(columns).toBeInstanceOf(Y.Array);
    expect(columns.get(0).get(YjsDatabaseKey.id)).toBe('column');
    expect(filterChildren).toBeInstanceOf(Y.Array);
    expect(filterChildren.get(0).get('id')).toBe('child-filter');
    act(() => {
      hooks.result.current.removeSort('sort');
      hooks.result.current.calculate(
        new Map([
          ['first', 'one'],
          ['second', 'two'],
        ])
      );
      columns.get(0).set(YjsDatabaseKey.visible, false);
    });
    expect(copied.get(YjsDatabaseKey.sorts).length).toBe(0);
    expect(copied.get(YjsDatabaseKey.calculations).get(0).get(YjsDatabaseKey.calculation_value)).toBe(2);
    expect(columns.get(0).get(YjsDatabaseKey.visible)).toBe(false);
    expect(copied.get(YjsDatabaseKey.row_orders).get(0)).not.toBeInstanceOf(Y.Map);
    expect(copied.get(YjsDatabaseKey.field_orders).get(0)).toEqual({ id: 'name' });
    expect(JSON.stringify(source)).toBe(before);
  } finally {
    hooks.unmount();
  }
});

test.each([true, false])('owned database copies exclude inactive rows and view orders (frozen=%s)', async (frozen) => {
  const source = archive();
  const [active, trashed] = source.rows;
  source.views[0].row_orders[1].is_deleted = true;
  source.row_metas![String(trashed.id)].is_document_empty = false;
  const params = input(document([{ viewIds: source.views.map((view) => view.id), databaseId: source.database_id }]));
  if (frozen) {
    snapshots(params, source);
  } else {
    params.template.documentData = undefined;
    const live = provideSource(source);
    const db = live.getMap('data').get('database') as YDatabase;
    const canonical = [...db.get(YjsDatabaseKey.views).values()].find((view) => view.get(YjsDatabaseKey.is_inline))!;
    const orders = canonical.get(YjsDatabaseKey.row_orders);
    orders.delete(1, 1);
    orders.insert(1, [{ id: String(trashed.id), height: 60, is_deleted: true }]);
    const row = keep(
      archivedRowDocument(active, undefined, String(active.id), source.database_id, new Map(), source.fields)
    );
    read.mockImplementation(async (_owner, path: string) => {
      if (path.endsWith('/restore-state')) return { database_restore_id: null, version: null };
      const container = path.includes(`/view/${id('owned-container')}`);
      return {
        view_id: container ? id('owned-container') : source.views.find((view) => path.includes(view.id))!.id,
        parent_view_id: container ? params.template.docViewId : id('owned-container'),
        layout: 1,
        children: [],
        has_children: container,
        extra: { database_id: source.database_id, is_database_container: container },
      };
    });
    sync.mockImplementation(async (_workspace, items) =>
      items.map((item: { objectId: string; collabType: Types }) => {
        if (item.collabType === Types.Database) return sourceResponse(live, item.objectId, item.collabType);
        expect(item.objectId).toBe(active.id);
        expect(item.collabType).toBe(Types.DatabaseRow);
        return sourceResponse(row, item.objectId, item.collabType);
      })
    );
  }
  const result = compound(await prepareTemplateRowGraph(params));
  const rows = result.manifest.objects.filter(
    (object) => object.kind === 'database_row' && object.object_id !== params.rowId
  );
  expect(rows).toHaveLength(1);
  const descriptor = result.manifest.objects.find((object) => object.kind === 'database')!;
  const copied = decode(result.seeds.get(descriptor.object_id)!).getMap('data').get('database') as YDatabase;
  copied.get(YjsDatabaseKey.views).forEach((view) => {
    expect(view.get(YjsDatabaseKey.row_orders).toArray()).toEqual([{ id: rows[0].object_id, height: 60 }]);
  });
  expect(result.manifest.objects.filter((object) => object.kind === 'document')).toHaveLength(1);
  expect(source.rows).toHaveLength(2);
  expect(source.views[0].row_orders[1].is_deleted).toBe(true);
  if (frozen) expect(sync).not.toHaveBeenCalled();
});

test('copied timeline dependencies remap both endpoints and retain custom types and lag', async () => {
  const source = archive();
  const [first, second] = source.rows.map((row) => String(row.id));
  const external = id('external-row');
  const view = source.views[0];
  view.layout = 8;
  view.layout_settings = {
    '8': {
      dependency_field_id: 'relation',
      dependency_direction: 1,
      dependency_links: {
        [`${first}:${second}`]: { ty: 3, lag: -4 },
        [`${second}:${first}`]: { ty: 2, lag: 7 },
        [`${first}:${external}`]: { ty: 1, lag: 2 },
      },
    },
  };
  source.fields.push({ id: 'relation', field_type: 10, type_options: {} });
  source.rows[0].cells = { relation: { field_type: 10, data: [second, external] } };
  const params = input(document([{ viewIds: [view.id], databaseId: source.database_id, ty: 'timeline' }]));
  snapshots(params, source);
  const result = compound(await prepareTemplateRowGraph(params));
  const descriptor = result.manifest.objects.find((object) => object.kind === 'database')!;
  const copied = decode(result.seeds.get(descriptor.object_id)!).getMap('data').get('database') as YDatabase;
  const copiedView = [...copied.get(YjsDatabaseKey.views)].find(([, view]) => !view.get(YjsDatabaseKey.is_inline))![0];
  const a = uuidv5(`row:${first}`, params.requestId);
  const b = uuidv5(`row:${second}`, params.requestId);
  expect(readTimelineLayoutSetting(copied, copiedView, 0, false).dependencyLinks).toEqual({
    [`${a}:${b}`]: { type: 3, lag: -4 },
    [`${b}:${a}`]: { type: 2, lag: 7 },
    [`${a}:${external}`]: { type: 1, lag: 2 },
  });
  const row = decode(result.seeds.get(a)!).getMap('data').get('data') as Y.Map<Y.Map<Y.Map<unknown>>>;
  expect((row.get('cells')!.get('relation')!.get('data') as Y.Array<string>).toArray()).toEqual([b, external]);
});

test('a frozen template in a copied database can still copy its owned child page', async () => {
  const source = archive();
  const templateBody = document();
  const childId = id('frozen-template-child');
  const sourceDocId = id('frozen-template-owner');
  documentBlocks(templateBody).set(
    'child',
    new Y.Map(
      Object.entries({
        id: 'child',
        ty: 'sub_page',
        parent: 'root',
        children: '',
        data: JSON.stringify({ viewId: childId }),
      })
    )
  );
  source.row_templates_meta = {
    row_templates: JSON.stringify([
      {
        ...legacyTemplateMetadata(sourceDocId),
        doc_data: encodeTemplateDocumentSnapshot(templateBody),
      },
    ]),
  };
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));
  snapshots(params, source);
  const [template] = createdTemplates(compound(await prepareTemplateRowGraph(params)));
  const snapshot = decodeTemplateDocumentSnapshot(template.doc_data)!;
  const useTemplate = input();
  useTemplate.template = {
    ...useTemplate.template,
    templateId: template.template_id,
    docViewId: template.doc_view_id,
    documentData: template.doc_data,
  };
  useTemplate.documentState = fromBase64(snapshot.encodedState);
  const child = document();
  read.mockResolvedValue({ view_id: childId, name: 'Owned child', parent_view_id: sourceDocId, layout: 0 });
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) => sourceResponse(child, item.objectId, item.collabType))
  );
  const result = compound(await prepareTemplateRowGraph(useTemplate));
  const copiedChild = result.manifest.views.find((view) => view.content.kind === 'document')!;
  expect(copiedChild.name).toBe('Owned child');
  expect(copiedChild.view_id).not.toBe(childId);
  expect(copiedChild.parent_view_id).toBe(uuidv5('document_id', useTemplate.rowId));
  const copiedBody = decode(result.seeds.get(copiedChild.parent_view_id)!);
  expect(JSON.parse(String(documentBlocks(copiedBody).get('child')!.get('data'))).viewId).toBe(copiedChild.view_id);
});

test('an empty frozen backing requires no live source lookup', async () => {
  const source = archive(id('source-database'), [id('grid')], 0);
  const params = input(document([{ viewIds: [id('grid')], databaseId: source.database_id }]));

  snapshots(params, source);
  const result = compound(await prepareTemplateRowGraph(params));

  expect(result.manifest.objects.filter((object) => object.kind === 'database_row')).toHaveLength(1);
  expect(read).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

test.each([false, true])(
  'linked archive keeps live authority and never copies source rows (self-link=%s)',
  async (self) => {
    const source = archive(self ? id('parent-database') : id('external-database'));
    const params = input(document([{ viewIds: source.views.map((view) => view.id), databaseId: source.database_id }]));
    const live = provideSource(source, id('version'));
    const before = Y.encodeStateAsUpdate(live);

    snapshots(params, source, true);
    const result = compound(await prepareTemplateRowGraph(params));
    const [extension] = result.manifest.database_extensions;

    expect(extension.database_id).toBe(source.database_id);
    expect(extension.source_view_id).toBe(self ? params.sourceViewId : source.views[0].id);
    expect(extension.views).toHaveLength(2);
    expect(extension.views[0].view.row_orders).toEqual(source.views[0].row_orders);
    expect(result.manifest.objects.map((object) => object.kind).sort()).toEqual(['database_row', 'document']);
    expect(Y.encodeStateAsUpdate(live)).toEqual(before);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0][1][0]).toMatchObject({ collabVersion: id('version') });
    const [primary, secondary] = result.manifest.views.filter((view) => view.content.kind === 'database_view');

    expect(secondary.parent_view_id).toBe(primary.view_id);
  }
);

test('owned and linked blocks of one archived backing join one copy', async () => {
  const source = archive();
  const params = input(document(source.views.map((view) => ({ viewIds: [view.id], databaseId: source.database_id }))));

  snapshots(params, source);
  params.template.embeddedDatabases[1].isLinked = true;
  const result = compound(await prepareTemplateRowGraph(params));

  expect(result.manifest.objects.filter((object) => object.kind === 'database')).toHaveLength(1);
  expect(result.manifest.database_extensions).toEqual([]);
  expect(read).not.toHaveBeenCalled();
});

test.each([false, true])('Form has complete sibling Responses membership (linked=%s)', async (linked) => {
  const source = archive(id('form-database'), [id('form')]);

  source.views[0].layout = 7;
  source.form_field_settings = { [id('form')]: { name: { required: true, visible: true } } };
  const params = input(document([{ viewIds: [id('form')], databaseId: source.database_id }]));

  snapshots(params, source, linked);
  if (linked) provideSource(source);
  const result = compound(await prepareTemplateRowGraph(params));
  const form = result.manifest.views.find((view) => view.content.kind === 'database_view' && view.content.layout === 9)!;

  if (form.content.kind !== 'database_view') throw new Error('Missing Form');
  const response = result.manifest.views.find((view) => view.view_id === form.content.responses_view_id)!;

  expect(response.parent_view_id).toBe(form.parent_view_id);
  expect(response.content).toMatchObject({ kind: 'database_view', layout: 1, database_id: form.content.database_id });
  if (linked)
    expect(result.manifest.database_extensions[0].views[0].form_field_settings).toEqual(
      source.form_field_settings[id('form')]
    );
});

test('conflicting frozen backings and missing snapshots fail before any source request', async () => {
  const source = archive();
  const params = input(document([{ viewIds: source.views.map((view) => view.id), databaseId: source.database_id }]));

  snapshots(params, source);
  params.template.embeddedDatabases[1].rawData = JSON.stringify({ ...source, rows: [] });
  await expect(prepareTemplateRowGraph(params)).rejects.toThrow('conflicting archived');
  params.template.embeddedDatabases.pop();
  await expect(prepareTemplateRowGraph(params)).rejects.toThrow('snapshot is missing');
  expect(sync).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

test('ownership cancellation and source restore changes cannot publish a graph', async () => {
  const source = archive();
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

  snapshots(params, source, true);
  provideSource(source);
  read
    .mockResolvedValueOnce({ database_restore_id: null, version: null })
    .mockResolvedValueOnce({ database_restore_id: id('restored'), version: id('version') });
  await expect(prepareTemplateRowGraph(params)).rejects.toThrow('restore generation changed');
  const controller = new AbortController();

  params.signal = controller.signal;
  controller.abort(new Error('cancelled'));
  await expect(prepareTemplateRowGraph(params)).rejects.toThrow('cancelled');
});

test('nested template v2 edits and tombstones survive a copied backing without stale projection', async () => {
  const source = archive();
  const old = {
    template_id: 'legacy-id',
    name: 'Old',
    doc_view_id: id('old-doc'),
    doc_data: [],
    is_document_empty: true,
    embedded_databases: [],
    default_cells: [],
    created_at_ms: 0,
    updated_at_ms: 0,
  };

  source.row_templates_meta = {
    row_templates: JSON.stringify([old]),
    'row_template_v2:legacy-id': JSON.stringify({ ...old, name: 'Current' }),
    default_row_template: 'legacy-id',
  };
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

  snapshots(params, source);
  const result = compound(await prepareTemplateRowGraph(params));
  const descriptor = result.manifest.objects.find((item) => item.kind === 'database')!;
  const root = decode(result.seeds.get(descriptor.object_id)!).getMap('data').get('database') as Y.Map<unknown>;
  const metas = root.get('metas') as Y.Map<unknown>;
  const [template] = JSON.parse(String(metas.get('row_templates')));

  expect(template.name).toBe('Current');
  expect(template.template_id).not.toBe('legacy-id');
  expect(template.doc_view_id).toBe(old.doc_view_id);
  expect(metas.get('default_row_template')).toBe(template.template_id);
});

test('linked template keeps valid order but drops deleted history and appends new live rows', async () => {
  const source = archive();
  const current = archive();
  const extra = { ...current.rows[1], id: id('later-row') };

  current.rows = [current.rows[1], extra];
  current.views.forEach((view) => {
    view.row_orders = current.rows.map((row) => ({ id: String(row.id), height: 60 }));
  });
  provideSource(current);
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

  snapshots(params, source, true);
  const result = compound(await prepareTemplateRowGraph(params));

  expect(result.manifest.database_extensions[0].views[0].view.row_orders.map((row) => row.id)).toEqual([
    source.rows[1].id,
    extra.id,
  ]);
});

test('legacy Folder wrapper expands its actual tabs and reads rows in one bounded batch', async () => {
  const source = archive();
  const live = provideSource(source);
  const sourceRows = new Map(
    source.rows.map((row) => [
      String(row.id),
      keep(archivedRowDocument(row, undefined, String(row.id), source.database_id, new Map(), source.fields)),
    ])
  );
  const wrapper = id('wrapper');
  const params = input(document([{ viewIds: [wrapper], databaseId: source.database_id }]));

  params.template.documentData = undefined;
  read.mockImplementation(async (_owner, path: string) => {
    if (path.endsWith('/restore-state')) return { database_restore_id: null, version: null };
    const viewId = path.split('/view/')[1].split('?')[0];

    return {
      view_id: viewId,
      parent_view_id: viewId === wrapper ? params.template.docViewId : wrapper,
      extra: { database_id: source.database_id, is_database_container: viewId === wrapper },
      children:
        viewId === wrapper
          ? source.views.map((view) => ({ view_id: view.id, extra: { database_id: source.database_id } }))
          : [],
    };
  });
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) => {
      const doc = item.collabType === Types.Database ? live : sourceRows.get(item.objectId)!;

      return {
        objectId: item.objectId,
        collabType: item.collabType,
        missingUpdate: Y.encodeStateAsUpdate(doc),
        serverStateVector: Y.encodeStateVector(doc),
      };
    })
  );
  const result = compound(await prepareTemplateRowGraph(params));
  const rootId = uuidv5('document_id', params.rowId);
  const copied = decode(result.seeds.get(rootId)!);
  const block = documentBlocks(copied).get('database-0')!;
  const refs = JSON.parse(String(block.get('data')));

  expect(refs.view_ids).toHaveLength(2);
  expect(refs.view_ids).not.toContain(wrapper);
  expect(result.manifest.objects.filter((object) => object.kind === 'database')).toHaveLength(1);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync.mock.calls[1][1]).toHaveLength(2);
});

test.each([false, true])('copied row backlinks share the copied backing (has trash=%s)', async (hasTrash) => {
  const source = archive();
  const sourceRowId = String(source.rows[0].id);
  const sourceDocument = document([{ viewIds: [source.views[1].id], databaseId: source.database_id }]);

  source.row_metas![sourceRowId].is_document_empty = false;
  if (hasTrash)
    source.views.forEach((view) => {
      view.row_orders[1].is_deleted = true;
    });
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

  snapshots(params, source);
  params.template.embeddedDatabases[1].isLinked = true;
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) => ({
      objectId: item.objectId,
      collabType: item.collabType,
      missingUpdate: Y.encodeStateAsUpdate(sourceDocument),
      serverStateVector: Y.encodeStateVector(sourceDocument),
    }))
  );
  const result = compound(await prepareTemplateRowGraph(params));
  const nested = result.manifest.views.find(
    (view) => view.content.kind === 'row_document' && view.content.row_id !== params.rowId
  )!;
  const backlink = result.manifest.views.find(
    (view) => view.parent_view_id === nested.view_id && view.content.kind === 'database_view'
  )!;

  expect(backlink).toBeDefined();
  expect(result.manifest.objects.filter((object) => object.kind === 'database')).toHaveLength(1);
  expect(result.manifest.objects.filter((object) => object.kind === 'database_row')).toHaveLength(hasTrash ? 2 : 3);
  expect(result.manifest.database_extensions).toEqual([]);
  expect(sync).toHaveBeenCalledTimes(1);
});

test('512-row frozen graph preparation stays local with one seed per row', async () => {
  const source = archive(id('large-database'), [id('large-grid')], 512);
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

  snapshots(params, source);
  const result = compound(await prepareTemplateRowGraph(params));

  expect(result.seeds.size).toBe(515);
  expect(result.manifest.objects.filter((object) => object.kind === 'database_row')).toHaveLength(513);
  expect(read).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

test('template child pages receive new owned documents instead of retaining source references', async () => {
  const root = document();
  const child = document();
  const childId = id('child-document');

  documentBlocks(root).set(
    'child',
    new Y.Map(
      Object.entries({
        id: 'child',
        ty: 'sub_page',
        parent: 'root',
        children: '',
        data: JSON.stringify({ viewId: childId }),
      })
    )
  );
  const params = input(root);

  read.mockResolvedValue({
    view_id: childId,
    name: 'Child page',
    layout: 0,
    parent_view_id: params.template.docViewId,
    extra: null,
    children: [],
  });
  sync.mockResolvedValue([
    {
      objectId: childId,
      collabType: Types.Document,
      missingUpdate: Y.encodeStateAsUpdate(child),
      serverStateVector: Y.encodeStateVector(child),
    },
  ]);
  const result = compound(await prepareTemplateRowGraph(params));
  const childView = result.manifest.views.find((view) => view.content.kind === 'document')!;
  const rootId = uuidv5('document_id', params.rowId);
  const copied = decode(result.seeds.get(rootId)!);

  expect(childView.parent_view_id).toBe(rootId);
  expect(childView.name).toBe('Child page');
  expect(childView.view_id).not.toBe(childId);
  expect(JSON.parse(String(documentBlocks(copied).get('child')!.get('data'))).viewId).toBe(childView.view_id);
});

test('child metadata loads concurrently with bounded fan-out and batched document reads', async () => {
  const root = document();
  const child = document();
  const childIds = Array.from({ length: 10 }, (_, index) => id(`sibling-${index}`));

  childIds.forEach((childId, index) => {
    documentBlocks(root).set(
      `child-${index}`,
      new Y.Map(Object.entries({
        id: `child-${index}`, ty: 'sub_page', parent: 'root', children: '',
        data: JSON.stringify({ viewId: childId }),
      }))
    );
  });
  const params = input(root);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });

  read.mockImplementation(async (_owner, path: string) => {
    await held;
    const childId = childIds.find((candidate) => path.includes(candidate))!;

    return { view_id: childId, name: childId, layout: 0, parent_view_id: params.template.docViewId };
  });
  sync.mockImplementation(async (_workspace, items) => items.map((item: { objectId: string }) => ({
    objectId: item.objectId,
    collabType: Types.Document,
    missingUpdate: Y.encodeStateAsUpdate(child),
    serverStateVector: Y.encodeStateVector(child),
  })));

  const pending = prepareTemplateRowGraph(params);

  expect(read).toHaveBeenCalledTimes(8);
  expect(sync).not.toHaveBeenCalled();
  release();
  const result = compound(await pending);

  expect(read).toHaveBeenCalledTimes(10);
  expect(sync.mock.calls.map((call) => call[1].map((item: { objectId: string }) => item.objectId)))
    .toEqual([childIds.slice(0, 8), childIds.slice(8)]);
  expect(result.manifest.views.filter((view) => view.content.kind === 'document')).toHaveLength(10);
});

test('incomplete source history and owner replacement are rejected before a manifest is returned', async () => {
  const source = archive();
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

  snapshots(params, source, true);
  provideSource(source);
  sync.mockResolvedValueOnce([
    {
      objectId: source.database_id,
      collabType: Types.Database,
      missingUpdate: new Uint8Array([0, 0]),
      serverStateVector: Y.encodeStateVector(document()),
    },
  ]);
  await expect(prepareTemplateRowGraph(params)).rejects.toThrow('history is incomplete');
  params.owner.assertCurrent = () => {
    throw new Error('workspace changed');
  };
  await expect(prepareTemplateRowGraph(params)).rejects.toThrow('workspace changed');
});

test('Yrs bigint timestamp wire values become JSON numbers before constructing copied Yjs views', async () => {
  const source = archive();
  const live = provideSource(source);
  const db = live.getMap('data').get('database') as Y.Map<unknown>;
  const view = (db.get('views') as Y.Map<Y.Map<unknown>>).get(source.views[0].id)!;

  // Rust inserts i64 as ContentAny bigint. Yjs decodes this wire type but Map.set cannot create it.
  // Build the server wire fixture by replacing only this isolated test item's scalar payload.
  const item = view._map.get('created_at')!;
  const content = item.content as unknown as { arr: unknown[] };

  content.arr[0] = BigInt(1792000000);
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

  params.template.documentData = undefined;
  read.mockImplementation(async (_owner, path: string) =>
    path.endsWith('/restore-state')
      ? { database_restore_id: null, version: null }
      : {
          view_id: path.includes(`/view/${id('owned-container')}`) ? id('owned-container') : source.views[0].id,
          parent_view_id: path.includes(`/view/${id('owned-container')}`)
            ? params.template.docViewId
            : id('owned-container'),
          layout: 1,
          children: [],
          has_children: path.includes(`/view/${id('owned-container')}`),
          extra: {
            database_id: source.database_id,
            is_database_container: path.includes(`/view/${id('owned-container')}`),
          },
        }
  );
  const rows = new Map(
    source.rows.map((row) => [
      String(row.id),
      keep(archivedRowDocument(row, undefined, String(row.id), source.database_id, new Map(), source.fields)),
    ])
  );

  sync.mockImplementation(async (_workspace, items) =>
    items.map((request: { objectId: string; collabType: Types }) => {
      const doc = request.collabType === Types.Database ? live : rows.get(request.objectId)!;

      return {
        objectId: request.objectId,
        collabType: request.collabType,
        missingUpdate: Y.encodeStateAsUpdate(doc),
        serverStateVector: Y.encodeStateVector(doc),
      };
    })
  );
  const result = compound(await prepareTemplateRowGraph(params));
  const descriptor = result.manifest.objects.find((object) => object.kind === 'database')!;
  const copied = decode(result.seeds.get(descriptor.object_id)!).getMap('data').get('database') as Y.Map<unknown>;
  const mounted = [...(copied.get('views') as Y.Map<Y.Map<unknown>>).values()].find(
    (candidate) => !candidate.get('is_inline')
  )!;

  expect(mounted.get('created_at')).toBe(1792000000);
});

test('copied media and relation cells retain readable shared arrays, external targets and lazy storage', async () => {
  const source = archive();
  const relatedRow = String(source.rows[1].id);
  const externalRow = id('external-related-row');
  const attachment = {
    id: id('attachment'),
    name: 'Image',
    file_type: 1,
    upload_type: 1,
    url: 'https://example.com/image.png',
  };

  source.fields.push(
    { id: 'relation', name: 'Related', field_type: 10, type_options: {} },
    { id: 'converted', name: 'Converted', field_type: 10, type_options: {} },
    { id: 'media', name: 'Media', field_type: FieldType.Media, type_options: {} },
    { id: 'converted-media', name: 'Converted media', field_type: FieldType.RichText, type_options: {} }
  );
  source.rows[0].cells = {
    relation: { field_type: 10, data: [relatedRow, externalRow] },
    converted: { field_type: 10, source_field_type: 0, data: relatedRow },
    media: { field_type: FieldType.Media, data: [JSON.stringify(attachment)] },
    'converted-media': {
      field_type: FieldType.RichText,
      source_field_type: FieldType.Media,
      data: [JSON.stringify(attachment)],
    },
  };
  const originalCells = JSON.parse(JSON.stringify(source.rows[0].cells));
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

  snapshots(params, source);
  const result = compound(await prepareTemplateRowGraph(params));
  const copiedRows = result.manifest.objects
    .filter((object) => object.kind === 'database_row' && object.object_id !== params.rowId)
    .map((object) => decode(result.seeds.get(object.object_id)!).getMap('data').get('data') as Y.Map<unknown>);
  const first = copiedRows.find((row) => (row.get('cells') as Y.Map<unknown>).has('relation'))!;
  const second = copiedRows.find((row) => row !== first)!;
  const cells = first.get('cells') as Y.Map<YDatabaseCell>;

  const relation = parseYDatabaseRelationCellToCell(cells.get('relation')!);

  expect(relation.data).toBeInstanceOf(Y.Array);
  expect((relation.data as Y.Array<string>).toArray()).toEqual([second.get('id'), externalRow]);
  expect(parseYDatabaseFileMediaCellToCell(cells.get('media')!).data).toEqual([attachment]);
  expect(parseYDatabaseFileMediaCellToCell(cells.get('converted-media')!).data).toEqual([attachment]);
  expect(cells.get('converted-media')!.get('source_field_type')).toBe(FieldType.Media);
  expect(cells.get('converted')!.get('data')).toBe(relatedRow);
  expect(source.rows[0].cells).toEqual(originalCells);
});

test.each([RelationFilterCondition.RelationContains, RelationFilterCondition.RelationDoesNotContain])(
  'copied nested relation filters preserve matching rows for condition %s',
  async (condition) => {
    const source = archive();
    const relatedRow = String(source.rows[1].id);
    const externalRow = id('external-related-row');
    const content = JSON.stringify([relatedRow, externalRow]);

    source.fields.push({
      id: 'relation',
      field_type: FieldType.Relation,
      type_options: { '10': { database_id: source.database_id } },
    });
    source.rows[0].cells = {
      name: { field_type: FieldType.RichText, data: content },
      relation: { field_type: FieldType.Relation, data: [relatedRow] },
    };
    source.rows[1].cells = { name: { field_type: FieldType.RichText, data: content } };
    source.views[0].filters = [
      {
        id: 'root',
        filter_type: FilterType.And,
        children: [
          {
            id: 'nested',
            filter_type: FilterType.Or,
            children: [
              {
                id: 'related',
                filter_type: FilterType.Data,
                field_id: 'relation',
                ty: FieldType.Relation,
                condition,
                content,
              },
            ],
          },
          {
            id: 'text',
            filter_type: FilterType.Data,
            field_id: 'name',
            ty: FieldType.RichText,
            condition: TextFilterCondition.TextIs,
            content,
          },
        ],
      },
    ];
    const originalFilters = JSON.parse(JSON.stringify(source.views[0].filters));
    const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

    snapshots(params, source);
    const result = compound(await prepareTemplateRowGraph(params));
    const descriptor = result.manifest.objects.find((object) => object.kind === 'database')!;
    const copied = decode(result.seeds.get(descriptor.object_id)!).getMap('data').get('database') as YDatabase;
    const mounted = [...copied.get('views').values()].find((view) => !view.get('is_inline'))!;
    const orders = mounted.get('row_orders').toArray();
    const filters = mounted.get('filters');
    const rowDocs = Object.fromEntries(orders.map((row) => [row.id, decode(result.seeds.get(row.id)!) as YDoc]));

    expect(filters.toJSON()).toEqual([
      {
        ...originalFilters[0],
        children: [
          {
            ...originalFilters[0].children[0],
            children: [
              { ...originalFilters[0].children[0].children[0], content: JSON.stringify([orders[1].id, externalRow]) },
            ],
          },
          originalFilters[0].children[1],
        ],
      },
    ]);
    expect(filterBy(orders, filters, copied.get('fields'), rowDocs)).toEqual([
      orders[condition === RelationFilterCondition.RelationContains ? 0 : 1],
    ]);
    expect(source.views[0].filters).toEqual(originalFilters);
  }
);

test.each(['viewId', 'database_view_id'])(
  'legacy database block %s references participate in the complete graph',
  async (key) => {
    const source = archive();
    const root = document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]);

    documentBlocks(root)
      .get('database-0')!
      .set('data', JSON.stringify({ [key]: source.views[0].id, database_id: source.database_id }));
    const params = input(root);

    snapshots(params, source);
    const result = compound(await prepareTemplateRowGraph(params));
    const rootId = uuidv5('document_id', params.rowId);
    const copied = decode(result.seeds.get(rootId)!);
    const data = JSON.parse(String(documentBlocks(copied).get('database-0')!.get('data')));

    expect(data[key]).not.toBe(source.views[0].id);
    expect(result.manifest.views.some((view) => view.view_id === data[key])).toBe(true);
    expect(result.manifest.objects.filter((object) => object.kind === 'database')).toHaveLength(1);
  }
);

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'live linked mounts retain their source backing (self=%s legacy container marker=%s)',
  async (self, legacyContainer) => {
    const source = archive(self ? id('parent-database') : id('external-database'));
    const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));

    params.template.documentData = undefined;
    provideSource(source);
    read.mockImplementation(async (_owner, path: string) => {
      if (path.endsWith('/restore-state')) return { database_restore_id: null, version: null };
      return {
        view_id: source.views[0].id,
        parent_view_id: params.template.docViewId,
        layout: 1,
        children: [],
        has_children: false,
        extra: { database_id: source.database_id, embedded: true, is_database_container: legacyContainer },
      };
    });
    const result = compound(await prepareTemplateRowGraph(params));

    expect(result.manifest.objects.map((object) => object.kind).sort()).toEqual(['database_row', 'document']);
    expect(result.manifest.database_extensions).toHaveLength(1);
    expect(result.manifest.database_extensions[0].database_id).toBe(source.database_id);
    expect(result.manifest.database_extensions[0].source_view_id).toBe(self ? params.sourceViewId : source.views[0].id);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0][1][0].collabType).toBe(Types.Database);
  }
);

function legacyTemplateMetadata(docId: string) {
  return {
    template_id: id('legacy-nested-template'),
    name: 'Legacy nested body',
    doc_view_id: docId,
    doc_data: [],
    is_document_empty: false,
    embedded_databases: [],
    default_cells: [],
    created_at_ms: 0,
    updated_at_ms: 0,
  };
}
function createdTemplates(result: ReturnType<typeof compound>) {
  const descriptor = result.manifest.objects.find((item) => item.kind === 'database')!;
  const root = decode(result.seeds.get(descriptor.object_id)!).getMap('data').get('database') as Y.Map<unknown>;
  return JSON.parse(String((root.get('metas') as Y.Map<unknown>).get('row_templates')));
}
function sourceResponse(doc: Y.Doc, objectId: string, collabType: Types) {
  return {
    objectId,
    collabType,
    missingUpdate: Y.encodeStateAsUpdate(doc),
    serverStateVector: Y.encodeStateVector(doc),
  };
}

test('copies legacy nested template bodies from canonical snapshots with one deduplicated read', async () => {
  const source = archive();
  const docId = id('legacy-nested-document');
  const body = document();
  const original = Y.encodeStateAsUpdate(body);
  const template = legacyTemplateMetadata(docId);
  source.row_templates_meta = {
    row_templates: JSON.stringify([
      template,
      { ...template, template_id: id('legacy-second-template') },
      { ...template, template_id: id('legacy-empty'), doc_view_id: id('empty-doc'), is_document_empty: true },
      {
        ...template,
        template_id: id('legacy-frozen'),
        doc_view_id: id('frozen-doc'),
        doc_data: encodeTemplateDocumentSnapshot(body),
      },
    ]),
    default_row_template: template.template_id,
  };
  const before = JSON.stringify(source);
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));
  snapshots(params, source);
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) => {
      expect(item.objectId).toBe(docId);
      expect(item.collabType).toBe(Types.Document);
      return sourceResponse(body, item.objectId, item.collabType);
    })
  );
  const result = compound(await prepareTemplateRowGraph(params));
  const templates = createdTemplates(result);
  expect(templates).toHaveLength(4);
  const decoded = decodeTemplateDocumentSnapshot(templates[0].doc_data)!;
  const restored = keep(new Y.Doc());
  Y.applyUpdate(restored, fromBase64(decoded.encodedState));
  expect(restored.getMap('data').toJSON()).toEqual(body.getMap('data').toJSON());
  expect(templates[1].doc_data).toEqual(templates[0].doc_data);
  expect(templates[2].doc_data).toEqual([]);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(sync.mock.calls[0][1]).toHaveLength(1);
  expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(source)).toBe(before);
  expect(Y.encodeStateAsUpdate(body)).toEqual(original);
});

test('legacy nested template snapshot reads are paged and corrupt bodies reject without partial graph', async () => {
  const source = archive();
  const body = document();
  source.row_templates_meta = {
    row_templates: JSON.stringify(
      Array.from({ length: 65 }, (_, index) => ({
        ...legacyTemplateMetadata(id(`nested-document-${index}`)),
        template_id: id(`nested-template-${index}`),
      }))
    ),
  };
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));
  snapshots(params, source);
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) => sourceResponse(body, item.objectId, item.collabType))
  );
  expect(createdTemplates(compound(await prepareTemplateRowGraph(params)))).toHaveLength(65);
  expect(sync.mock.calls.map((call) => call[1].length)).toEqual([32, 32, 1]);
  const invalid = keep(new Y.Doc());
  invalid.getMap('data').set('invalid', true);
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) => sourceResponse(invalid, item.objectId, item.collabType))
  );
  await expect(prepareTemplateRowGraph(params)).rejects.toThrow('Invalid template document tree');
});

test('legacy nested template freezes a linked database without copying rows or mutating the source body', async () => {
  const source = archive();
  const linked = archive(id('nested-linked-database'), [id('nested-linked-view')], 2);
  const database = provideSource(linked);
  const docId = id('legacy-linked-document');
  const body = document([{ viewIds: [linked.views[0].id], databaseId: linked.database_id }]);
  const before = Y.encodeStateAsUpdate(body);
  source.row_templates_meta = { row_templates: JSON.stringify([legacyTemplateMetadata(docId)]) };
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));
  snapshots(params, source);
  read.mockImplementation(async (_owner, path: string) =>
    path.endsWith('/restore-state')
      ? { database_restore_id: null, version: null }
      : {
          view_id: linked.views[0].id,
          parent_view_id: docId,
          layout: 1,
          children: [],
          extra: { database_id: linked.database_id },
        }
  );
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) =>
      sourceResponse(item.collabType === Types.Document ? body : database, item.objectId, item.collabType)
    )
  );
  const result = compound(await prepareTemplateRowGraph(params));
  const [template] = createdTemplates(result);
  expect(template.embedded_databases).toHaveLength(1);
  expect(template.embedded_databases[0]).toMatchObject({
    source_view_id: linked.views[0].id,
    source_database_id: linked.database_id,
    is_linked: true,
    layout_type: 1,
  });
  expect(JSON.parse(template.embedded_databases[0].raw_data).rows).toEqual([]);
  expect(sync.mock.calls.flatMap((call) => call[1]).map((item) => item.collabType)).toEqual([
    Types.Document,
    Types.Database,
  ]);
  expect(Y.encodeStateAsUpdate(body)).toEqual(before);
  expect(result.manifest.database_extensions).toEqual([]); // dormant template links are not published yet
});

test('legacy nested template freezes owned database rows and nested bodies once without publishing dormant graphs', async () => {
  const source = archive();
  const nested = archive(id('dormant-owned-db'), [id('dormant-owned-view')], 2);
  const live = provideSource(nested);
  const innerId = id('inner-template-doc');
  const innerBody = document();
  const innerTemplate = legacyTemplateMetadata(innerId);
  ((live.getMap('data').get('database') as Y.Map<unknown>).get('metas') as Y.Map<unknown>).set(
    'row_templates',
    JSON.stringify([innerTemplate])
  );
  const outerId = id('outer-template-doc');
  const containerId = id('dormant-container');
  const body = document([{ viewIds: [containerId], databaseId: nested.database_id }]);
  const before = Y.encodeStateAsUpdate(body);
  const rowDocs = new Map(
    nested.rows.map((row) => [
      String(row.id),
      keep(archivedRowDocument(row, undefined, String(row.id), nested.database_id, new Map(), nested.fields)),
    ])
  );
  source.row_templates_meta = { row_templates: JSON.stringify([legacyTemplateMetadata(outerId)]) };
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));
  snapshots(params, source);
  read.mockImplementation(async (_owner, path: string) =>
    path.endsWith('/restore-state')
      ? { database_restore_id: null, version: null }
      : {
          view_id: containerId,
          parent_view_id: outerId,
          layout: 1,
          has_children: true,
          children: [{ view_id: nested.views[0].id, extra: { database_id: nested.database_id } }],
          extra: { database_id: nested.database_id, is_database_container: true },
        }
  );
  sync.mockImplementation(async (_workspace, items) =>
    items.map((item: { objectId: string; collabType: Types }) =>
      sourceResponse(
        item.objectId === outerId ? body : item.objectId === innerId ? innerBody : rowDocs.get(item.objectId) ?? live,
        item.objectId,
        item.collabType
      )
    )
  );
  const result = compound(await prepareTemplateRowGraph(params));
  const [template] = createdTemplates(result);
  expect(template.embedded_databases).toHaveLength(1);
  expect(template.embedded_databases[0]).toMatchObject({
    source_view_id: nested.views[0].id,
    source_database_id: nested.database_id,
    is_linked: false,
  });
  const saved = JSON.parse(template.embedded_databases[0].raw_data);
  expect(saved.rows).toHaveLength(2);
  const [inner] = JSON.parse(saved.row_templates_meta.row_templates);
  expect(decodeTemplateDocumentSnapshot(inner.doc_data)?.isDocumentEmpty).toBe(false);
  expect(sync.mock.calls.map((call) => call[1].map((item: { collabType: Types }) => item.collabType))).toEqual([
    [Types.Document],
    [Types.Database],
    [Types.DatabaseRow, Types.DatabaseRow],
    [Types.Document],
  ]);
  expect(result.manifest.objects.filter((object) => object.kind === 'database')).toHaveLength(1);
  expect(Y.encodeStateAsUpdate(body)).toEqual(before);
});

test('legacy linked blocks retain the explicit database identity when Folder metadata lacks it', async () => {
  const source = archive();
  const params = input(document([{ viewIds: [source.views[0].id], databaseId: source.database_id }]));
  params.template.documentData = undefined;
  provideSource(source);
  read.mockImplementation(async (_owner, path: string) =>
    path.endsWith('/restore-state')
      ? { database_restore_id: null, version: null }
      : { view_id: source.views[0].id, parent_view_id: params.template.docViewId, children: [], layout: 1 }
  );
  const result = compound(await prepareTemplateRowGraph(params));
  expect(result.manifest.database_extensions[0].database_id).toBe(source.database_id);
  expect(result.manifest.objects.map((object) => object.kind).sort()).toEqual(['database_row', 'document']);
});
