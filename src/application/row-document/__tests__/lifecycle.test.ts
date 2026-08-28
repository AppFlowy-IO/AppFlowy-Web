jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

jest.mock('@/application/services/domains', () => ({
  PageService: { updateName: jest.fn() },
  ViewService: { createOrphaned: jest.fn() },
}));

import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import {
  ensureRowDocumentView,
  getRowDocumentSourceFromView,
  rowDocumentIdFromRowId,
  syncRowDocumentViewName,
} from '@/application/row-document/lifecycle';
import { PageService, ViewService } from '@/application/services/domains';
import { View } from '@/application/types';

const ROW_ID = '7bfad25e-2ba1-4d61-8ee2-4c61099df01a';

function viewWithExtra(extra: View['extra']): View {
  return {
    view_id: 'doc-1',
    name: 'Row page',
    icon: null,
    layout: 0,
    extra,
    children: [],
    is_published: false,
    is_private: false,
  } as unknown as View;
}

describe('row-document lifecycle helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('derives the deterministic row document id from the row id', () => {
    const expected = getMetaIdMap(ROW_ID).get(RowMetaKey.DocumentId);

    expect(rowDocumentIdFromRowId(ROW_ID)).toBe(expected);
    expect(rowDocumentIdFromRowId(ROW_ID)).not.toBe('');
  });

  it('parses a complete row_document source from view extra', () => {
    const view = viewWithExtra({
      row_document: {
        source: { database_id: 'db', database_view_id: 'view', row_id: ROW_ID },
      },
    });

    expect(getRowDocumentSourceFromView(view)).toEqual({
      database_id: 'db',
      database_view_id: 'view',
      row_id: ROW_ID,
    });
  });

  it('returns null for missing or incomplete sources', () => {
    expect(getRowDocumentSourceFromView(null)).toBeNull();
    expect(getRowDocumentSourceFromView(viewWithExtra(null))).toBeNull();
    expect(getRowDocumentSourceFromView(viewWithExtra({}))).toBeNull();
    expect(
      getRowDocumentSourceFromView(
        viewWithExtra({ row_document: { source: { database_id: 'db', row_id: ROW_ID } } })
      )
    ).toBeNull();
  });

  it('ensureRowDocumentView returns false instead of throwing on failure', async () => {
    (ViewService.createOrphaned as jest.Mock).mockRejectedValueOnce(new Error('conflict'));

    await expect(
      ensureRowDocumentView('ws', 'doc-1', { database_id: 'db', database_view_id: 'view', row_id: ROW_ID })
    ).resolves.toBe(false);

    (ViewService.createOrphaned as jest.Mock).mockResolvedValueOnce(new Uint8Array());

    await expect(
      ensureRowDocumentView('ws', 'doc-1', { database_id: 'db', database_view_id: 'view', row_id: ROW_ID })
    ).resolves.toBe(true);
    expect(ViewService.createOrphaned).toHaveBeenCalledWith('ws', {
      document_id: 'doc-1',
      row_document_source: { database_id: 'db', database_view_id: 'view', row_id: ROW_ID },
    });
  });

  it('syncRowDocumentViewName swallows failures', async () => {
    (PageService.updateName as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    await expect(syncRowDocumentViewName('ws', 'doc-1', 'Title')).resolves.toBeUndefined();
    expect(PageService.updateName).toHaveBeenCalledWith('ws', 'doc-1', 'Title');
  });
});
