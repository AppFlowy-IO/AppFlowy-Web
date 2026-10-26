import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, FieldType, RowMetaKey } from '@/application/database-yjs';
import { generateRowMeta } from '@/application/database-yjs/row_meta';
import { createRowOrdersStore } from '@/application/database-yjs/row-orders-store';
import { DatabaseViewLayout, RowCoverType, YjsDatabaseKey, YjsEditorKey, type YDoc } from '@/application/types';
import { ReactComponent as GalleryIcon } from '@/assets/icons/gallery.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import {
  DatabaseSearchProvider,
  useDatabaseSearch,
} from '@/components/database/components/conditions/DatabaseSearchContext';
import GallerySettings from '@/components/database/components/settings/GallerySettings';
import Gallery from '@/components/database/gallery/Gallery';
import { GalleryViewProvider } from '@/components/database/gallery/GalleryViewContext';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';

import '@/i18n/config';
import '@/styles/global.css';

const databaseDoc = new Y.Doc() as YDoc;
const fields = new Y.Map<Y.Map<unknown>>();
const view = new Y.Map<unknown>();
const rowOrders = new Y.Array<{ id: string; height: number }>();
const fieldSettings = new Y.Map<Y.Map<unknown>>();
const definitions = [
  { id: 'title', name: 'Name', type: FieldType.RichText },
  { id: 'category', name: 'Category', type: FieldType.SingleSelect },
  { id: 'tags', name: 'Tags', type: FieldType.MultiSelect },
  { id: 'description', name: 'Description', type: FieldType.RichText },
];
const options = [
  { id: 'mauve', name: 'Mauve', color: 'Purple' },
  { id: 'camellia', name: 'Camellia', color: 'LightPink' },
  { id: 'grass', name: 'Grass', color: 'Green' },
];

definitions.forEach(({ id, name, type }) => {
  fields.set(
    id,
    new Y.Map<unknown>([
      ['id', id],
      ['name', name],
      [YjsDatabaseKey.type, type],
      ['is_primary', id === 'title'],
      ['type_option', new Y.Map([[String(type), new Y.Map([['content', JSON.stringify({ options })]])]])],
    ])
  );
  fieldSettings.set(
    id,
    new Y.Map<unknown>([
      ['visibility', 0],
      ['wrap_cell_content', true],
    ])
  );
});
view.set('id', 'gallery');
view.set('layout', DatabaseViewLayout.Gallery);
view.set('field_orders', Y.Array.from(definitions.map(({ id }) => ({ id }))));
view.set('field_settings', fieldSettings);
view.set('row_orders', rowOrders);
view.set('groups', new Y.Array());
view.set('filters', new Y.Array());
view.set('sorts', new Y.Array());
view.set(
  'layout_settings',
  new Y.Map([
    [
      '5',
      new Y.Map<unknown>([
        ['card_size', 1],
        ['card_preview', 0],
        ['show_cover', true],
        ['fit_image', false],
      ]),
    ],
  ])
);
databaseDoc.getMap('data').set(
  'database',
  new Y.Map<unknown>([
    ['id', 'database'],
    ['fields', fields],
    ['views', new Y.Map([['gallery', view]])],
  ])
);

const titles = ['The Art of Living in the Moment', 'A Quiet Place to Think', 'Finding Joy in Everyday Life'];
const rowMap: Record<string, YDoc> = {};

titles.forEach((title, index) => {
  const id = `00000000-0000-4000-8000-00000000000${index + 1}`;
  const doc = new Y.Doc() as YDoc;
  const values = [
    title,
    index === 1 ? 'camellia' : 'mauve',
    'mauve,camellia,grass',
    'Mindfulness enhances well-being by promoting present-moment awareness and acceptance.',
  ];
  const cells = new Y.Map(
    definitions.map((field, i) => [
      field.id,
      new Y.Map<unknown>([
        ['field_type', field.type],
        ['data', values[i]],
      ]),
    ])
  );

  doc.getMap('data').set(
    YjsEditorKey.database_row,
    new Y.Map<unknown>([
      ['id', id],
      ['database_id', 'database'],
      ['cells', cells],
      ['created_at', '0'],
      ['last_modified', '0'],
    ])
  );
  doc.getMap('data').set(
    'meta',
    new Y.Map(
      Object.entries(
        generateRowMeta(id, {
          [RowMetaKey.IsDocumentEmpty]: false,
          [RowMetaKey.CoverId]: JSON.stringify({
            cover_type: RowCoverType.FileCover,
            data: `/covers/m_cover_image_${index + 1}.png`,
            offset: 0,
          }),
        })
      )
    )
  );
  rowMap[id] = doc;
  rowOrders.push([{ id, height: 36 }]);
});

const context: DatabaseContextState = {
  databaseDoc,
  activeViewId: 'gallery',
  databasePageId: 'database',
  workspaceId: '',
  rowMap,
  rowOrdersStore: createRowOrdersStore(),
  readOnly: false,
  ensureRow: async (id) => rowMap[id],
  navigateToRow: (id) => {
    document.getElementById('opened-row')!.textContent = id;
  },
};

function Header({ readOnly }: { readOnly: boolean }) {
  const { query, setQuery } = useDatabaseSearch();

  return (
    <header
      style={{ padding: '32px 80px 8px' }}
      className='flex items-center gap-3 px-20 pb-2 pt-8 text-sm text-text-primary'
    >
      <GalleryIcon className='h-5 w-5' />
      <span className='font-medium'>Gallery</span>
      <input
        aria-label='Search Gallery'
        className='ml-auto h-8 rounded-md border border-border-primary bg-surface-primary px-2'
        placeholder='Search'
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!readOnly && (
        <GallerySettings>
          <Button variant='ghost' size='icon' data-testid='fixture-settings'>
            <SettingsIcon className='h-5 w-5' />
          </Button>
        </GallerySettings>
      )}
    </header>
  );
}

function Fixture() {
  const [readOnly, setReadOnly] = useState(false);
  return (
    <AFConfigContext.Provider
      value={{ isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
    >
      <MemoryRouter>
        <TooltipProvider>
          <DatabaseContext.Provider value={{ ...context, readOnly }}>
            <GalleryViewProvider>
              <DatabaseSearchProvider activeViewId='gallery'>
                <div style={{ minHeight: '100vh' }} className='flex min-h-screen flex-col bg-surface-primary text-text-primary'>
                  <Header readOnly={readOnly} />
                  <Gallery />
                  <footer className='mt-8 px-20 text-xs text-text-secondary'>
                    <label>
                      <input
                        type='checkbox'
                        checked={readOnly}
                        onChange={(event) => setReadOnly(event.target.checked)}
                      />{' '}
                      Read only
                    </label>
                    <output id='opened-row' aria-label='Opened row' />
                  </footer>
                </div>
              </DatabaseSearchProvider>
            </GalleryViewProvider>
          </DatabaseContext.Provider>
        </TooltipProvider>
      </MemoryRouter>
    </AFConfigContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
