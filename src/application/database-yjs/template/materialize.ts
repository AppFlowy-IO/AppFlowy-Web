import { fromBase64 } from 'lib0/buffer';
import * as Y from 'yjs';

import { createCloudRow } from '@/application/database-yjs/creation/create-row';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { YDatabase, YDoc, YjsDatabaseKey } from '@/application/types';

import { initializeTemplateSourceRow } from './cell';

import type { DatabaseRowTemplate } from './types';

/** Materialize native archives through the same atomic graph SDK used to instantiate a row. */
export async function materializeTemplateSource(input: {
  workspaceId: string;
  databaseDoc: YDoc;
  database: YDatabase;
  sourceViewId: string;
  guid: string;
  rowId: string;
  template: DatabaseRowTemplate;
  encodedState: string;
  assertCurrent: () => void;
  registerRow: () => Promise<YDoc>;
}): Promise<YDoc> {
  const rowDoc = new Y.Doc({ guid: input.rowId }) as YDoc;
  let bound: YDoc | undefined;

  try {
    initializeTemplateSourceRow(rowDoc, input.database, { ...input.template, templateId: input.rowId });
    await createCloudRow({
      workspaceId: input.workspaceId,
      databaseDoc: input.databaseDoc,
      databaseId: input.database.get(YjsDatabaseKey.id),
      sourceViewId: input.sourceViewId,
      rowId: input.rowId,
      rowKey: getRowKey(input.guid, input.rowId),
      rowDoc,
      position: { kind: 'end' },
      isTemplateSource: true,
      template: input.template,
      documentState: fromBase64(input.encodedState),
      assertCurrent: input.assertCurrent,
      registerRow: async () => (bound = await input.registerRow()),
    });
    if (!bound) throw new Error('Template source was not activated');
    return bound;
  } finally {
    rowDoc.destroy();
  }
}
