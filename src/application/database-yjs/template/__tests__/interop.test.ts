import * as Y from 'yjs';

import { readTemplateRecords, writeTemplateRecords } from '../storage';

import fixture from './fixtures/row_template_interop.json';

jest.unmock('lodash-es/isEqual');

it('merges real Desktop Yrs updates with Web edits and a concurrent deletion', () => {
  const doc = new Y.Doc();

  Y.applyUpdate(doc, Buffer.from(fixture.base_update, 'base64'));
  const metas = doc.getMap('metas');
  const records = readTemplateRecords(metas);

  records[1] = { ...records[1], name: 'Web 🧭', icon: '', cover: '' };
  records.push({ ...records[1], template_id: 'c', name: 'Created on Web', doc_view_id: 'c' });
  doc.transact(() => writeTemplateRecords(metas, records));
  Y.applyUpdate(doc, Buffer.from(fixture.desktop_update, 'base64'));
  const merged = readTemplateRecords(metas).sort((a, b) => a.template_id.localeCompare(b.template_id));

  expect(merged.map(({ template_id, name, icon }) => [template_id, name, icon])).toEqual([
    ['a', 'Desktop 📘', '📘'], ['b', 'Web 🧭', ''], ['c', 'Created on Web', ''],
  ]);
  expect(JSON.parse(merged[0].cover as string)).toMatchObject({ cover_type: 0, data: '#123456', upload_type: 1 });
  expect(merged[1].cover).toBe('');
  doc.destroy();
});
