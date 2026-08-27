import { parseDatabaseRowTemplateState, parseDatabaseRowTemplates, serializeDatabaseRowTemplates } from '../codec';
import { DatabaseRowTemplate } from '../types';

const template: DatabaseRowTemplate = {
  templateId: 'template-id',
  name: 'Bug report',
  docViewId: 'document-id',
  documentData: [1, 2, 3],
  isDocumentEmpty: false,
  embeddedDatabases: [
    {
      sourceViewId: 'view-id',
      sourceDatabaseId: 'database-id',
      layoutType: 0,
      name: 'Tasks',
      rawData: '{"database_id":"database-id"}',
      isLinked: false,
    },
  ],
  defaultCells: {
    title: { type: 'text', value: 'Bug' },
    done: { type: 'checkbox', value: true },
    labels: { type: 'select', value: ['urgent', 'web'] },
    project: { type: 'relation', value: ['row-a', 'row-b'] },
  },
  icon: '🐞',
  cover: '{"cover_type":0,"data":"1"}',
  createdAtMs: 10,
  updatedAtMs: 20,
};

describe('database row template codec', () => {
  it('round-trips the Desktop metadata shape without losing typed values or snapshots', () => {
    expect(parseDatabaseRowTemplates(serializeDatabaseRowTemplates([template]))).toEqual([template]);
  });

  it('keeps legacy field-to-string cells readable', () => {
    const parsed = parseDatabaseRowTemplates(
      JSON.stringify([
        {
          template_id: 'legacy',
          name: 'Legacy',
          doc_view_id: 'legacy-document',
          default_cells: { title: 'Legacy title' },
          created_at_ms: 1,
          updated_at_ms: 1,
        },
      ])
    );

    expect(parsed[0].defaultCells).toEqual({ title: { type: 'legacy', value: 'Legacy title' } });
    expect(JSON.parse(serializeDatabaseRowTemplates(parsed))[0].default_cells).toEqual([
      { field_id: 'title', type: 'legacy', value: 'Legacy title' },
    ]);
    expect(parsed[0].isDocumentEmpty).toBe(true);
  });

  it('drops malformed entries and stale defaults', () => {
    const state = parseDatabaseRowTemplateState(
      JSON.stringify([
        { template_id: '', name: 'Missing template id', doc_view_id: 'missing-template-id' },
        { template_id: 'missing-name', doc_view_id: 'document-id' },
        { template_id: 'missing-document', name: 'Missing document', doc_view_id: '', doc_data: [] },
        { template_id: 'valid', doc_view_id: 'document-id', name: 'Valid' },
      ]),
      'deleted-template'
    );

    expect(state.templates.map((item) => item.templateId)).toEqual(['valid']);
    expect(state.defaultTemplateId).toBeUndefined();
  });

  it('treats invalid JSON as an empty template list', () => {
    expect(parseDatabaseRowTemplates('{not json')).toEqual([]);
  });

  it('reads every typed cell variant written by Desktop', () => {
    const parsed = parseDatabaseRowTemplates(
      JSON.stringify([
        {
          template_id: 'all-types',
          name: 'All types',
          doc_view_id: 'document-id',
          default_cells: [
            { field_id: 'text', type: 'text', value: 'hello' },
            { field_id: 'number', type: 'number', value: '1.25' },
            { field_id: 'checkbox', type: 'checkbox', value: false },
            { field_id: 'date', type: 'date_time', value: 1710000000 },
            { field_id: 'time', type: 'time', value: 75 },
            { field_id: 'url', type: 'url', value: 'https://appflowy.io' },
            { field_id: 'select', type: 'select', value: ['one', '', 'two'] },
            { field_id: 'person', type: 'person', value: ['person-id', ''] },
            { field_id: 'relation', type: 'relation', value: ['row-a', 'row-b'] },
          ],
          created_at_ms: 1,
          updated_at_ms: 2,
        },
      ])
    );

    expect(parsed[0].defaultCells).toEqual({
      text: { type: 'text', value: 'hello' },
      number: { type: 'number', value: '1.25' },
      checkbox: { type: 'checkbox', value: false },
      date: { type: 'date_time', value: 1710000000 },
      time: { type: 'time', value: 75 },
      url: { type: 'url', value: 'https://appflowy.io' },
      select: { type: 'select', value: ['one', '', 'two'] },
      person: { type: 'person', value: ['person-id', ''] },
      relation: { type: 'relation', value: ['row-a', 'row-b'] },
    });
  });

  it('drops invalid typed values and malformed embedded snapshots without rejecting the template', () => {
    const parsed = parseDatabaseRowTemplates(
      JSON.stringify([
        {
          template_id: 'partially-valid',
          name: 'Partially valid',
          doc_view_id: 'document-id',
          doc_data: [-1, 1, 256, '2', 3],
          default_cells: [
            { field_id: 'valid', type: 'text', value: 'kept' },
            { field_id: 'bad-bool', type: 'checkbox', value: 'true' },
            { field_id: 'bad-list', type: 'select', value: 'one' },
            { field_id: 'fractional-i64', type: 'date_time', value: 1.5 },
            { field_id: 'unknown', type: 'unsupported', value: 'drop' },
          ],
          embedded_databases: [
            { source_view_id: '', raw_data: '{}' },
            {
              source_view_id: 'view',
              source_database_id: 'database',
              layout_type: 2,
              name: 'Calendar',
              raw_data: '{"database_id":"database"}',
              is_linked: true,
            },
          ],
        },
      ])
    );

    expect(parsed[0].documentData).toEqual([1, 3]);
    expect(parsed[0].defaultCells).toEqual({ valid: { type: 'text', value: 'kept' } });
    expect(parsed[0].embeddedDatabases).toEqual([
      {
        sourceViewId: 'view',
        sourceDatabaseId: 'database',
        layoutType: 2,
        name: 'Calendar',
        rawData: '{"database_id":"database"}',
        isLinked: true,
      },
    ]);
  });

  it('uses stable fallbacks for optional legacy metadata', () => {
    const before = Date.now();
    const parsed = parseDatabaseRowTemplates(
      JSON.stringify([{ template_id: 'legacy-minimum', name: 'Legacy minimum', doc_view_id: 'document-id' }])
    )[0];

    expect(parsed.name).toBe('Legacy minimum');
    expect(parsed.isDocumentEmpty).toBe(true);
    expect(parsed.embeddedDatabases).toEqual([]);
    expect(parsed.defaultCells).toEqual({});
    expect(parsed.createdAtMs).toBeGreaterThanOrEqual(before);
    expect(parsed.updatedAtMs).toBe(parsed.createdAtMs);
  });

  it('reads Desktop snapshot-only metadata when doc_view_id is empty', () => {
    const desktopJson = JSON.stringify([
      {
        template_id: 'snapshot-only',
        name: 'Snapshot only',
        doc_view_id: '',
        doc_data: [10, 20, 30],
        is_document_empty: false,
        embedded_databases: [],
        default_cells: [],
        created_at_ms: 1723456789000,
        updated_at_ms: 1723456789001,
      },
    ]);

    expect(parseDatabaseRowTemplates(desktopJson)).toEqual([
      {
        templateId: 'snapshot-only',
        name: 'Snapshot only',
        docViewId: '',
        documentData: [10, 20, 30],
        isDocumentEmpty: false,
        embeddedDatabases: [],
        defaultCells: {},
        createdAtMs: 1723456789000,
        updatedAtMs: 1723456789001,
      },
    ]);
  });

  it('writes the exact Desktop Rust snake-case metadata contract', () => {
    const withoutDecorations = { ...template, icon: undefined, cover: undefined };

    expect(JSON.parse(serializeDatabaseRowTemplates([withoutDecorations]))).toEqual([
      {
        template_id: 'template-id',
        name: 'Bug report',
        doc_view_id: 'document-id',
        doc_data: [1, 2, 3],
        is_document_empty: false,
        embedded_databases: [
          {
            source_view_id: 'view-id',
            source_database_id: 'database-id',
            layout_type: 0,
            name: 'Tasks',
            raw_data: '{"database_id":"database-id"}',
            is_linked: false,
          },
        ],
        default_cells: [
          { field_id: 'title', type: 'text', value: 'Bug' },
          { field_id: 'done', type: 'checkbox', value: true },
          { field_id: 'labels', type: 'select', value: ['urgent', 'web'] },
          { field_id: 'project', type: 'relation', value: ['row-a', 'row-b'] },
        ],
        created_at_ms: 10,
        updated_at_ms: 20,
      },
    ]);
  });

  it('repairs non-i64 numeric JSON before it can be persisted back to Desktop', () => {
    const parsed = parseDatabaseRowTemplates(
      JSON.stringify([
        {
          template_id: 'safe-integers',
          name: 'Safe integers',
          doc_view_id: 'document-id',
          embedded_databases: [
            {
              source_view_id: 'view-id',
              source_database_id: 'database-id',
              layout_type: 1.5,
              name: 'Grid',
              raw_data: '{}',
            },
          ],
          default_cells: [{ field_id: 'date', type: 'date_time', value: 1.5 }],
          created_at_ms: 1.5,
          updated_at_ms: Number.MAX_SAFE_INTEGER + 1,
        },
      ])
    )[0];
    const serialized = JSON.parse(serializeDatabaseRowTemplates([parsed]))[0];

    expect(parsed.defaultCells).toEqual({});
    expect(serialized.embedded_databases[0].layout_type).toBe(0);
    expect(Number.isSafeInteger(serialized.created_at_ms)).toBe(true);
    expect(Number.isSafeInteger(serialized.updated_at_ms)).toBe(true);
  });

  it('never serializes JavaScript-only numbers into Desktop i64 fields', () => {
    const serialized = JSON.parse(
      serializeDatabaseRowTemplates([
        {
          ...template,
          createdAtMs: Number.NaN,
          updatedAtMs: 2.5,
          embeddedDatabases: [{ ...template.embeddedDatabases[0], layoutType: Number.POSITIVE_INFINITY }],
          defaultCells: {
            ...template.defaultCells,
            unsafeDate: { type: 'date_time', value: 1.5 },
          },
        },
      ])
    )[0];

    expect(serialized.default_cells).not.toContainEqual(expect.objectContaining({ field_id: 'unsafeDate' }));
    expect(serialized.embedded_databases[0].layout_type).toBe(0);
    expect(Number.isSafeInteger(serialized.created_at_ms)).toBe(true);
    expect(serialized.updated_at_ms).toBe(serialized.created_at_ms);
  });
});
