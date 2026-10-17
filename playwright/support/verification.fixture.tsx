import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { useRowOrdersSelector } from '@/application/database-yjs/selector';
import { initAPIService } from '@/application/services/js-services/http/core';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseRow,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey as K,
  YjsEditorKey as E,
} from '@/application/types';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { DatabaseConditionsContext } from '@/components/database/components/conditions/context';
import { DatabaseConditions } from '@/components/database/components/conditions/DatabaseConditions';
import FiltersButton from '@/components/database/components/conditions/FiltersButton';
import SortsButton from '@/components/database/components/conditions/SortsButton';
import PropertyMenu from '@/components/database/components/property/PropertyMenu';
import { AFConfigContext } from '@/components/main/app.hooks';
import { VerificationDatabaseValues } from '@/components/page-verification/VerificationDatabaseValues';
import '@/i18n/config';
import '@/styles/global.css';

initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
const databaseId = 'verification-browser-database';
const viewId = 'verification-browser-view';
const storageKey = 'verification-browser-yjs';
const doc = new Y.Doc() as YDoc;
const restored = sessionStorage.getItem(storageKey);

if (restored) Y.applyUpdate(doc, Uint8Array.from(JSON.parse(restored)));
else {
  const database = new Y.Map() as YDatabase;

  doc.getMap(E.data_section).set(E.database, database);
  database.set(K.id, databaseId);
  database.set(K.metas, new Y.Map([[K.iid, viewId]]));
  const fields = new Y.Map<YDatabaseField>();

  database.set(K.fields, fields);
  for (const [id, name, type] of [
    ['name', 'Name', FieldType.RichText],
    ['number', 'Number', FieldType.Number],
    ['verification', 'Verification', FieldType.Verification],
  ] as const) {
    const field = new Y.Map() as YDatabaseField;

    field.set(K.id, id);
    field.set(K.name, name);
    field.set(K.type, type);
    field.set(K.is_primary, id === 'name');
    const options = new Y.Map();
    const option = new Y.Map();

    options.set(String(type), option);
    if (type === FieldType.Verification) option.set(K.property_id, 'generation-a');
    field.set(K.type_option, options);
    fields.set(id, field);
  }

  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  database.set(K.views, views);
  views.set(viewId, view);
  view.set(K.id, viewId);
  view.set(K.layout, DatabaseViewLayout.Grid);
  view.set(K.field_orders, Y.Array.from(['name', 'number', 'verification'].map((id) => ({ id }))));
  const settings = new Y.Map();

  for (const id of ['name', 'number', 'verification'])
    settings.set(id, new Y.Map([[K.visibility, FieldVisibility.AlwaysShown]]));
  view.set(K.field_settings, settings);
  view.set(K.filters, new Y.Array());
  view.set(K.sorts, new Y.Array());
  view.set(
    K.row_orders,
    Y.Array.from(['unknown', 'expired', 'verified', 'unverified'].map((id) => ({ id, height: 36 })))
  );
}

doc.on('update', () => sessionStorage.setItem(storageKey, JSON.stringify(Array.from(Y.encodeStateAsUpdate(doc)))));
const rowMap = Object.fromEntries(
  ['unknown', 'expired', 'verified', 'unverified'].map((id) => {
    const rowDoc = new Y.Doc() as YDoc;
    const row = new Y.Map() as YDatabaseRow;

    rowDoc.getMap(E.data_section).set(E.database_row, row);
    row.set(K.id, id);
    row.set(K.database_id, databaseId);
    const cells = new Y.Map();

    row.set(K.cells, cells);
    for (const [fieldId, type, data] of [
      ['name', FieldType.RichText, id],
      ['number', FieldType.Number, id === 'unknown' || id === 'unverified' ? '10' : '1'],
    ] as const) {
      cells.set(
        fieldId,
        new Y.Map<unknown>([
          [K.field_type, type],
          [K.data, data],
        ])
      );
    }

    return [id, rowDoc];
  })
);
const context: DatabaseContextState = {
  databaseDoc: doc,
  databasePageId: viewId,
  activeViewId: viewId,
  workspaceId: 'verification-browser-workspace',
  readOnly: false,
  rowMap,
  paddingStart: 0,
  paddingEnd: 0,
  blobPrefetchComplete: true,
  seedsReady: true,
};

function Rows() {
  const rows = useRowOrdersSelector();

  return (
    <ol data-testid='visible-rows'>
      {rows?.map(({ id }) => (
        <li key={id}>{id}</li>
      ))}
    </ol>
  );
}

function Fixture() {
  const [expanded, setExpanded] = useState(true);
  const [openFilterId, setOpenFilterId] = useState<string>();
  const [isAdvancedMode, setAdvancedMode] = useState(false);
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [schema, setSchema] = useState('');

  useEffect(() => {
    const update = () => setSchema(JSON.stringify(doc.toJSON()));

    doc.on('update', update);
    update();
    return () => doc.off('update', update);
  }, []);
  return (
    <AFConfigContext.Provider
      value={{
        isAuthenticated: true,
        authenticatedUserId: 'verification-browser-user',
        updateCurrentUser: async () => undefined,
        openLoginModal: () => undefined,
      }}
    >
      <AuthInternalContext.Provider
        value={{
          currentWorkspaceId: context.workspaceId,
          isAuthenticated: true,
          aiEnabled: false,
          onChangeWorkspace: async () => undefined,
        }}
      >
        <DatabaseContext.Provider value={context}>
          <DatabaseConditionsContext.Provider
            value={{
              expanded,
              setExpanded,
              toggleExpanded: () => setExpanded((value) => !value),
              openFilterId,
              setOpenFilterId,
              isAdvancedMode,
              setAdvancedMode,
              advancedPanelOpen,
              setAdvancedPanelOpen,
              sortMenuOpen,
              setSortMenuOpen,
            }}
          >
            <VerificationDatabaseValues />
            <main className='mx-auto max-w-5xl p-8'>
              <h1>Verification browser fixture</h1>
              <div className='flex'>
                <FiltersButton expanded={expanded} toggleExpanded={() => setExpanded((value) => !value)} />
                <SortsButton expanded={expanded} toggleExpanded={() => setExpanded((value) => !value)} />
                <PropertyMenu fieldId='verification'>
                  <button>Verification property</button>
                </PropertyMenu>
                <PropertyMenu fieldId='number'>
                  <button>Number property</button>
                </PropertyMenu>
              </div>
              <DatabaseConditions />
              <Rows />
              <output data-testid='native-schema' className='hidden'>
                {schema}
              </output>
            </main>
          </DatabaseConditionsContext.Provider>
        </DatabaseContext.Provider>
      </AuthInternalContext.Provider>
    </AFConfigContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
