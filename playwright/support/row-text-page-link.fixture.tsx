import EventEmitter from 'events';

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import type { TextCell as TextCellValue } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { readRichTextFromCell } from '@/application/database-yjs/fields/text/rich-text';
import { type View, ViewLayout, type YDatabaseCell, type YDoc, YjsEditorKey } from '@/application/types';
import { TextCell } from '@/components/database/components/cell/text/TextCell';
import { AFConfigContext } from '@/components/main/app.hooks';
import AppTheme from '@/components/main/AppTheme';

import '@/i18n/config';
import '@/styles/global.css';

const workspaceId = '2f8365f8-ce19-4376-8ba0-2b4948ed0f4a';
const pageId = 'd996a5f3-0bca-40ed-96b7-5938de6cdd5d';
const rowId = '60bc40a0-04ad-4104-a58f-0c180ec49996';
const storageKey = 'row-text-page-link-fixture';
const saved = sessionStorage.getItem(storageKey);
const databaseDoc = new Y.Doc() as YDoc;
const rowDoc = new Y.Doc() as YDoc;
const fields = new Y.Map();
const cell = new Y.Map<unknown>(
  Object.entries(saved ? JSON.parse(saved) : { data: '', field_type: FieldType.RichText })
) as YDatabaseCell;

fields.set('notes', new Y.Map<unknown>([
  ['id', 'notes'], ['name', 'Notes'], ['ty', FieldType.RichText], ['is_primary', false],
]));
databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, new Y.Map([
  ['id', 'page-link-fixture'], ['fields', fields], ['views', new Y.Map()],
]));
rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, new Y.Map<unknown>([
  ['id', rowId], ['database_id', 'page-link-fixture'], ['cells', new Y.Map([['notes', cell]])],
  ['created_at', '0'], ['last_modified', '0'],
]));

const context: DatabaseContextState = {
  databaseDoc, rowMap: { [rowId]: rowDoc }, activeViewId: pageId, databasePageId: pageId,
  workspaceId, eventEmitter: new EventEmitter(), readOnly: false, canWrite: true,
  ensureRow: async () => rowDoc,
  loadViewMeta: async (viewId) => ({
    view_id: viewId, name: 'Mention target', layout: ViewLayout.Document, children: [],
    icon: null, extra: { is_space: false }, is_published: false, is_private: false,
  }) as View,
};

function Fixture() {
  const [editing, setEditing] = useState(!saved);
  const [, refresh] = useState(0);

  useEffect(() => {
    const changed = () => {
      sessionStorage.setItem(storageKey, JSON.stringify(cell.toJSON()));
      refresh((revision) => revision + 1);
    };

    rowDoc.on('update', changed);
    return () => rowDoc.off('update', changed);
  }, []);

  const value: TextCellValue = {
    data: String(cell.get('data') ?? ''), richText: readRichTextFromCell(cell),
    fieldType: FieldType.RichText, createdAt: 0, lastModified: 0,
  };

  return (
    <MemoryRouter>
      <AFConfigContext.Provider value={{
        isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined,
      }}>
        <DatabaseContext.Provider value={context}>
          <main className='min-h-screen bg-surface-primary p-10 text-text-primary'>
            <h1 className='mb-6 text-xl font-medium'>Row Text property</h1>
            <p className='mb-5 text-sm'>Paste this preview page's URL into Notes. The saved value is retained only in this preview.</p>
            <code className='mb-6 block text-xs'>{location.href}</code>
            <div className='flex items-start gap-5'>
              <span className='pt-3 text-sm'>Notes</span>
              <div data-testid='notes-property' className='min-h-12 w-[600px] rounded border border-border-primary p-3'>
                <TextCell
                  rowId={rowId} fieldId='notes' fieldName='Notes' fieldType={FieldType.RichText}
                  cell={value}
                  editing={editing} setEditing={setEditing} wrap
                />
              </div>
            </div>
            <button data-testid='edit-notes' className='mt-5 rounded border border-border-primary px-3 py-2' onClick={() => setEditing(true)}>
              Edit Notes
            </button>
            <pre data-testid='saved-cell' className='mt-8 whitespace-pre-wrap text-xs'>{JSON.stringify(cell.toJSON())}</pre>
          </main>
        </DatabaseContext.Provider>
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}

createRoot(document.getElementById('root')!).render(<AppTheme><Fixture /></AppTheme>);
