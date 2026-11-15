// Browser fixture: production React/Yjs components, with HTTP supplied by Playwright.
import React, { useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { createFormWriter } from '@/application/database-yjs/form-writer';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { initAPIService } from '@/application/services/js-services/http/core';
import {
  DatabaseViewLayout,
  ViewLayout,
  type YDoc,
  type YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { AFConfigContext } from '@/components/main/app.hooks';
import FormViewScope from '@/components/database/form/FormViewScope';
import DatabaseActions from '@/components/database/components/conditions/DatabaseActions';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { FormBuilderView } from '@/components/database/form/FormBuilderView';
import { TooltipProvider } from '@/components/ui/tooltip';
import AppTheme from '@/components/main/AppTheme';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import '@/styles/global.css';

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      translation: {
        grid: {
          menuName: 'Grid',
          settings: { layout: 'Layout' },
          field: {
            textFieldName: 'Text',
            numberFieldName: 'Number',
            singleSelectFieldName: 'Select',
            multiSelectFieldName: 'Multi-select',
            checkboxFieldName: 'Checkbox',
            dateFieldName: 'Date',
            urlFieldName: 'URL',
            mediaFieldName: 'File & Media',
          },
        },
        settings: { title: 'Settings' },
        form: { menuName: 'Form', builderName: 'Form builder' },
      },
    },
  },
});
initAPIService({ baseURL: location.origin, gotrueURL: location.origin + '/gotrue', wsURL: '' });
const doc = new Y.Doc({ guid: 'form-fixture' }) as YDoc;
const saved = localStorage.getItem('form-refactor-yjs');
if (saved) {
  Y.applyUpdate(doc, Uint8Array.from(JSON.parse(saved)));
} else {
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map() as YDatabaseView;
  view.set(YjsDatabaseKey.id, 'form-view');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Form);
  view.set(YjsDatabaseKey.field_orders, new Y.Array());
  view.set(YjsDatabaseKey.field_settings, new Y.Map());
  views.set('form-view', view);
  database.set(YjsDatabaseKey.id, 'form-database');
  database.set(YjsDatabaseKey.fields, new Y.Map());
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  createFormWriter(view).markDecided();
}
doc.on('update', () =>
  localStorage.setItem('form-refactor-yjs', JSON.stringify(Array.from(Y.encodeStateAsUpdate(doc))))
);
const noop = async () => undefined;
function Fixture() {
  const theme = useContext(ThemeModeContext);
  const [readOnly, setReadOnly] = useState(false);
  const [body, setBody] = useState(false);
  const context = {
    databaseDoc: doc,
    activeViewId: 'form-view',
    databasePageId: 'form-view',
    readOnly,
    canShare: !readOnly,
    rowMap: {},
    loadView: noop,
  } as unknown as DatabaseContextState;
  return (
    <MemoryRouter>
      <AFConfigContext.Provider
        value={{
          isAuthenticated: true,
          authenticatedUserId: 'fixture-user',
          updateCurrentUser: noop,
          openLoginModal: noop,
        }}
      >
        <AuthInternalContext.Provider
          value={{ isAuthenticated: true, currentWorkspaceId: 'fixture-workspace', onChangeWorkspace: noop }}
        >
          <TooltipProvider>
            <DatabaseContext.Provider value={context}>
              <FormViewScope>
                <main className='mx-auto flex h-screen max-w-[920px] flex-col bg-surface-primary text-text-primary'>
                  <header
                    data-testid='fixture-tab-bar'
                    className='flex min-h-9 items-center justify-between border-b border-border-primary'
                  >
                    <span className='flex items-center gap-1.5 px-4 text-sm font-medium'>
                      <PageIcon iconSize={16} view={{ layout: ViewLayout.Form }} className='h-4 w-4 shrink-0' />
                      Form builder
                    </span>
                    <DatabaseActions />
                  </header>
                  {body && (
                    <div className='min-h-0 flex-1'>
                      <FormBuilderView />
                    </div>
                  )}
                  <footer className='flex gap-2 border-t border-border-primary p-2'>
                    <Button variant='outline' onClick={() => setBody(true)}>
                      Mount form body
                    </Button>
                    <Button variant='outline' onClick={() => setReadOnly(!readOnly)}>
                      Toggle read only
                    </Button>
                    <Button variant='outline' onClick={() => getOrCreateDatabaseHistoryManager(doc).undo()}>
                      Undo
                    </Button>
                    <Button variant='outline' onClick={() => getOrCreateDatabaseHistoryManager(doc).redo()}>
                      Redo
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => {
                        theme?.setDark(!theme.isDark);
                      }}
                    >
                      Toggle theme
                    </Button>
                  </footer>
                </main>
                <Toaster />
              </FormViewScope>
            </DatabaseContext.Provider>
          </TooltipProvider>
        </AuthInternalContext.Provider>
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}
createRoot(document.getElementById('root')!).render(
  <AppTheme>
    <Fixture />
  </AppTheme>
);
