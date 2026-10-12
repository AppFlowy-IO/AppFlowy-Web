import * as Y from 'yjs';

import { RowMetaKey } from '@/application/database-yjs/database.type';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { writeTemplateRecords } from '@/application/database-yjs/template/storage';

import { hasCurrentRowDocumentSource } from '../row-source-readiness';

const rowId = '11111111-1111-4111-8111-111111111111';
const documentId = getMetaIdMap(rowId).get(RowMetaKey.DocumentId)!;

it.each(['current', 'missing', 'deleted', 'other-row', 'other-document', 'missing-view'])('checks %s hidden template source', (kind) => {
  const doc = new Y.Doc();
  const root = doc.getMap('database');
  const metas = new Y.Map<unknown>();

  root.set('metas', metas);
  root.set('views', new Y.Map([['view', new Y.Map([['row_orders', new Y.Array()]])]]));
  if (kind !== 'missing') {
    writeTemplateRecords(metas, [{
      template_id: kind === 'other-row' ? 'another-row' : rowId,
      name: 'Template', doc_view_id: kind === 'other-document' ? 'another-document' : documentId,
    }]);
  }

  if (kind === 'deleted') writeTemplateRecords(metas, []);

  expect(hasCurrentRowDocumentSource(root, kind === 'missing-view' ? 'another-view' : 'view', rowId)).toBe(kind === 'current');
  doc.destroy();
});
