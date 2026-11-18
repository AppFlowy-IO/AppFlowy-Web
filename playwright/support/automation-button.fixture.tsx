import { createInstance } from 'i18next';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import * as Y from 'yjs';

import en from '@/@types/translations/en.json';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { initAPIService } from '@/application/services/js-services/http/core';
import { type User, type YDoc, YjsEditorKey } from '@/application/types';
import { Cell } from '@/components/database/components/cell/Cell';
import { CenterPeekHeader } from '@/components/database/components/database-row/RowPeekHeader';
import { AFConfigContext } from '@/components/main/app.hooks';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';
import '@/styles/global.css';

const language = createInstance();

await language.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } });
initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
  status: 'available',
  info: {
    enable_page_history: false,
    self_hosted: true,
    enable_database_automations: true,
    database_automation_triggers: ['row_created', 'manual', 'button'],
    database_automation_actions: ['notify'],
    database_automation_scope_features: [
      'row_scoped_v1',
      ...(new URLSearchParams(location.search).has('interactions') ? ['button_interactions_v1'] : []),
    ],
  },
});
const rowSetup = new URLSearchParams(location.search).has('row-setup');
const doc = new Y.Doc() as YDoc;
const options = new Y.Map([['20', new Y.Map([['label', 'Request review']])]]);
const field = new Y.Map<unknown>([
  ['id', 'review'],
  ['name', 'Review'],
  ['ty', FieldType.Button],
  ['type_option', options],
]);
const view = new Y.Map<unknown>([
  ['id', 'grid'],
  ['row_orders', new Y.Array()],
  ['field_orders', Y.Array.from(rowSetup ? [] : [{ id: 'review' }])],
  ['field_settings', new Y.Map()],
]);

doc.getMap(YjsEditorKey.data_section).set(
  YjsEditorKey.database,
  new Y.Map<unknown>([
    ['id', 'tasks'],
    ['fields', new Y.Map(rowSetup ? [] : [['review', field]])],
    ['views', new Y.Map([['grid', view]])],
  ])
);
const context: DatabaseContextState = {
  databaseDoc: doc,
  activeViewId: 'grid',
  databasePageId: 'grid',
  workspaceId: 'team',
  rowMap: {},
  readOnly: rowSetup,
  canWrite: false,
};

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={language}>
    <AFConfigContext.Provider
      value={{
        isAuthenticated: true,
        currentUser: { uuid: 'clicker' } as User,
        openLoginModal: () => undefined,
        updateCurrentUser: async () => undefined,
      }}
    >
      <DatabaseContext.Provider value={context}>
        {rowSetup ? (
          <CenterPeekHeader rowId='second' onClose={() => undefined} />
        ) : (
          ['first', 'second'].map((rowId) => <Cell key={rowId} rowId={rowId} fieldId='review' wrap={false} />)
        )}
      </DatabaseContext.Provider>
    </AFConfigContext.Provider>
  </I18nextProvider>
);
