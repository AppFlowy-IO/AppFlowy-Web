import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { evaluateRollupCell } from '@/application/database-yjs/rollup/cache';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { YDoc, YjsDatabaseKey as K } from '@/application/types';

import { evaluateFormulaCell } from '../evaluate';
import { readFormulaSchema } from '../schema';

import { createRow } from './fixture';
import scenarios from './researched-scenarios.json';
import { database, databaseOf, reload, rowOf } from './value-combination-fixture';

const campaign = scenarios.scenarios.find(({ id }) => id === 'campaign-open-rate')!;
const campaigns = campaign.rows!;
const subsets = Array.from({ length: 16 }, (_, mask) => mask);

describe('campaign Formula open rates → Average Rollup → downstream Formula', () => {
  // Source: https://support.airtable.com/articles/7497685062-rollup-field-overview
  // Published campaign averaging example, extended with actual 0% and a blank
  // rate to distinguish the arithmetic denominator from the number of links.
  const sourceId = 'campaign-value-source';
  const ownerId = 'campaign-value-owner';
  const source = database(sourceId, [
    { id: 'title', name: 'Title', type: FieldType.RichText },
    { id: 'opened', name: 'Opened', type: FieldType.Number },
    { id: 'sent', name: 'Sent', type: FieldType.Number },
    {
      id: 'rate',
      name: 'Open rate',
      type: FieldType.Formula,
      typeOption: { expression: 'if(empty(prop("Sent")), empty(), prop("Opened") / prop("Sent") * 100)' },
    },
  ]);
  const owner = database(ownerId, [
    { id: 'campaigns', name: 'Campaigns', type: FieldType.Relation, typeOption: { database_id: sourceId } },
    {
      id: 'average',
      name: 'Average rate',
      type: FieldType.Rollup,
      typeOption: {
        relation_field_id: 'campaigns',
        target_field_id: 'rate',
        calculation_type: CalculationType.Average,
        show_as: RollupDisplayMode.Calculated,
      },
    },
    {
      id: 'summary',
      name: 'Summary',
      type: FieldType.Formula,
      typeOption: {
        expression: 'if(empty(prop("Average rate")), "No positive rate", format(prop("Average rate")) + "% average")',
      },
    },
  ]);
  const rows = campaigns.map((campaign, index) => {
    const row = createRow(`campaign-${index}`, {
      title: { type: FieldType.RichText, data: campaign.name },
      opened: { type: FieldType.Number, data: String(campaign.opened) },
      sent: { type: FieldType.Number, data: String(campaign.sent) },
    });

    row.row.set(K.database_id, sourceId);
    return row;
  });
  const restoredSource = reload(source.doc);
  const restoredOwner = reload(owner.doc);
  const restoredRows = rows.map(({ doc }) => reload(doc));
  const docs: YDoc[] = [
    source.doc,
    owner.doc,
    restoredSource,
    restoredOwner,
    ...rows.map(({ doc }) => doc),
    ...restoredRows,
  ];

  afterAll(() => docs.forEach((doc) => doc.destroy()));

  it('has four independently specified source Formula rates and sixteen subsets', () => {
    expect(campaign.case_count).toBe(16);
    expect(campaigns.map(({ expected_rate }) => expected_rate)).toEqual([20, 40, 0, null]);
    for (const [sourceDoc, sourceRows] of [
      [source.doc, rows.map(({ doc }) => doc)],
      [restoredSource, restoredRows],
    ] as const) {
      const schema = readFormulaSchema(databaseOf(sourceDoc).get(K.fields));
      const field = schema.find(({ id }) => id === 'rate')!.field;

      sourceRows.forEach((doc, index) => {
        const row = rowOf(doc);
        const result = evaluateFormulaCell({ schema, field, fieldId: 'rate', row, rowId: row.get(K.id) });

        expect(result.error).toBeUndefined();
        expect(result.value).toEqual(
          campaigns[index].expected_rate === null
            ? { type: 'empty' }
            : { type: 'number', value: campaigns[index].expected_rate }
        );
      });
    }
  });

  it.each(subsets)('subset mask %i averages numeric Formula values and survives Yjs reload', async (mask) => {
    const indexes = campaigns.map((_row, index) => index).filter((index) => (mask & (1 << index)) !== 0);
    const numericRates = indexes
      .map((index) => campaigns[index].expected_rate)
      .filter((rate): rate is number => rate !== null);
    const expected = numericRates.length
      ? numericRates.reduce((sum, rate) => sum + rate, 0) / numericRates.length
      : undefined;
    const { doc, row } = createRow(`campaign-owner-${mask}`, {
      campaigns: { type: FieldType.Relation, data: { yArray: indexes.map((index) => `campaign-${index}`) } },
    });

    row.set(K.database_id, ownerId);
    const restoredRow = reload(doc);

    docs.push(doc, restoredRow);
    for (const [ownerDoc, ownerRow, sourceDoc, sourceRows] of [
      [owner.doc, row, source.doc, rows.map(({ doc }) => doc)],
      [restoredOwner, rowOf(restoredRow), restoredSource, restoredRows],
    ] as const) {
      const db = databaseOf(ownerDoc);
      const fields = db.get(K.fields);
      const rowMap = new Map(sourceRows.map((doc) => [getRowKey(sourceId, rowOf(doc).get(K.id)), doc]));
      const rollup = await evaluateRollupCell({
        baseDoc: ownerDoc,
        database: db,
        rollupField: fields.get('average'),
        fieldId: 'average',
        row: ownerRow,
        rowId: ownerRow.get(K.id),
        loadView: async (id) => (id === sourceId ? sourceDoc : null),
        getViewIdFromDatabaseId: async (id) => id,
        createRow: async (key) => rowMap.get(key)!,
      });

      expect(rollup.error).toBeUndefined();
      expect(rollup.rawNumeric).toBe(expected);
      if (expected === undefined) expect(rollup.value).toBe('');
      const result = evaluateFormulaCell({
        schema: readFormulaSchema(fields),
        field: fields.get('summary'),
        fieldId: 'summary',
        row: ownerRow,
        rowId: ownerRow.get(K.id),
        getRollupValue: () => rollup,
      });

      expect(result.error).toBeUndefined();
      expect(result.text).toBe(expected ? `${expected}% average` : 'No positive rate');
    }
  });
});
