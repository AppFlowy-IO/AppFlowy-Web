import { createInstance } from 'i18next';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import en from '@/@types/translations/en.json';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { getAxios, initAPIService } from '@/application/services/js-services/http/core';
import { DatabaseViewLayout, type View, ViewLayout, type YDoc, YjsEditorKey } from '@/application/types';
import { AppOperationsContext } from '@/components/app/contexts/AppOperationsContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { DocumentWidthMenu } from '@/components/app/view-actions/DocumentWidthMenu';
import ChartSettings from '@/components/database/components/settings/ChartSettings';
import { AFConfigContext } from '@/components/main/app.hooks';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';
import '@/styles/global.css';

const language = createInstance();

await language.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
  status: 'available', info: { self_hosted: true, enable_page_history: false },
});

// The database is an in-memory boundary; the settings host, panel, hooks,
// dispatch and Radix focus/pointer behavior are the production components.
const doc = new Y.Doc({ guid: 'chart-settings-browser-fixture' }) as YDoc;
const database = new Y.Map<unknown>();
const fields = new Y.Map<Y.Map<unknown>>();
const view = new Y.Map<unknown>();
const views = new Y.Map([['chart-view', view]]);
const setting = new Y.Map<unknown>([
  ['chart_type', 0], ['x_field_id', 'role'], ['aggregation_type', 0], ['show_empty_values', true],
]);

doc.getMap(YjsEditorKey.data_section).set('database', database);
database.set('id', doc.guid); database.set('fields', fields); database.set('views', views);
for (const [id, name, type] of [
  ['name', 'Name', FieldType.RichText], ['role', 'Role', FieldType.SingleSelect], ['amount', 'Amount', FieldType.Number],
] as const) {
  fields.set(id, new Y.Map<unknown>([['id', id], ['name', name], ['ty', type], ['is_primary', id === 'name']]));
}

view.set('id', 'chart-view'); view.set('name', 'Chart'); view.set('layout', DatabaseViewLayout.Chart);
view.set('field_orders', Y.Array.from([{ id: 'name' }, { id: 'role' }, { id: 'amount' }]));
view.set('field_settings', new Y.Map()); view.set('row_orders', new Y.Array());
view.set('layout_settings', new Y.Map([['3', setting]]));

const context: DatabaseContextState = {
  databaseDoc: doc, databasePageId: 'chart-container', activeViewId: 'chart-view', workspaceId: 'fixture',
  readOnly: false, canWrite: true, rowMap: {},
};

function WidthFixture() {
  const initialExtra = { is_space: false, preserve_me: 'owned fixture' };
  const [document, setDocument] = useState<View>({
    view_id: 'width-document', name: 'Document', layout: ViewLayout.Document,
    children: [], extra: initialExtra, icon: null, is_published: false, is_private: false,
  });

  return (
    <AppOperationsContext.Provider value={{
      toView: async () => undefined,
      loadView: async () => { throw new Error('The width fixture does not load document content'); },
      loadViewMeta: async () => { throw new Error('Navigation uses the real ViewService HTTP boundary'); },
      updatePage: async (id, payload) => {
        const response = await getAxios()!.patch(`/api/workspace/width-workspace/page-view/${id}`, payload);

        if (response.data.code !== 0) throw new Error('Width update refused');
        setDocument((previous) => ({ ...previous, ...payload,
          extra: payload.extra === null ? null : { ...previous.extra, ...payload.extra, is_space: false } }));
      },
    }}>
      <div style={{ display: 'flex', justifyContent: 'end', marginTop: 300 }}>
        <DropdownMenu><DropdownMenuTrigger asChild><button type='button'>Document menu</button></DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DocumentWidthMenu view={document} workspaceId='width-workspace' disabled={false} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <pre data-testid='width-setting'>{JSON.stringify(document.extra)}</pre>
    </AppOperationsContext.Provider>
  );
}

function Fixture() {
  const [, refresh] = useState(0);

  useEffect(() => {
    const changed = () => refresh((revision) => revision + 1);

    doc.on('update', changed);
    return () => doc.off('update', changed);
  }, []);
  return (
    <main style={{ padding: 24 }}>
      <button type='button'>Outside</button>
      <div style={{ display: 'flex', justifyContent: 'end', marginTop: 70 }}>
        <ChartSettings><button type='button'>Settings</button></ChartSettings>
      </div>
      <pre data-testid='chart-setting'>{JSON.stringify((view.get('layout_settings') as Y.Map<Y.Map<unknown>>).get('3')?.toJSON(), (_key, value: unknown) => typeof value === 'bigint' ? Number(value) : value)}</pre>
      <WidthFixture />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={language}><MemoryRouter>
    <AFConfigContext.Provider value={{ isAuthenticated: false, openLoginModal: () => undefined,
      updateCurrentUser: async () => undefined }}>
      <AuthInternalContext.Provider value={{ isAuthenticated: false, onChangeWorkspace: async () => undefined }}>
        <DatabaseContext.Provider value={context}><Fixture /></DatabaseContext.Provider>
      </AuthInternalContext.Provider>
    </AFConfigContext.Provider>
  </MemoryRouter></I18nextProvider>
);
