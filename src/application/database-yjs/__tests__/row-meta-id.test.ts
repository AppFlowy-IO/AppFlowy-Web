import { metaIdFromRowId } from '@/application/database-yjs/const';
import { RowMetaKey } from '@/application/database-yjs/database.type';

// Expected UUID v5 values independently derived from the server's 16-byte row namespace.
describe('server row metadata identity', () => {
  it.each([
    ['228df7d4-31ad-0a54-5283-eae45a7a3bc8', 'b5858962-53fd-53da-be00-9e0de1e10d37'],
    ['FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', 'fa7d1f3a-cf2c-519c-b6e5-53dcb73f2cc1'],
    ['c4de2428-2a42-4df4-8969-6bc60f5f26b0', 'ab4626b0-99c1-5554-9d3e-fa00a34e1b50'],
  ])('uses the server namespace for row %s', (rowId, documentId) => {
    expect(metaIdFromRowId(rowId)(RowMetaKey.DocumentId)).toBe(documentId);
    expect(metaIdFromRowId(rowId)(RowMetaKey.DocumentId)).toBe(documentId);
  });

  it('addresses existing server metadata for a hash-derived row', () => {
    const meta = metaIdFromRowId('228df7d4-31ad-0a54-5283-eae45a7a3bc8');
    expect(meta(RowMetaKey.IconId)).toBe('9654d750-87c5-5d29-b259-549d22ad61b1');
    expect(meta(RowMetaKey.CoverId)).toBe('d1f0ed47-b3a5-5944-9f0a-7653fba73cfb');
    expect(meta(RowMetaKey.IsDocumentEmpty)).toBe('417d33a5-b231-5fa1-bfa0-243cc3ba728a');
  });
});
