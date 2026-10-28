import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import en from '@/@types/translations/en.json';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { initAPIService, getAxios } from '@/application/services/js-services/http/core';
import { createDatabaseView } from '@/application/services/js-services/http/page-api';
import { saveGoTrueAuth } from '@/application/session/token';
import { setCurrentSession } from '@/application/sync-outbox';
import { type View, type YDatabase, type YDoc, ViewLayout, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { DashboardProvider, useDashboardContext, useDashboardLayout } from '@/components/database/dashboard/DashboardContext';
import { WidgetContext, type WidgetContextValue } from '@/components/database/dashboard/WidgetContext';
import { WidgetMenu } from '@/components/database/dashboard/WidgetMenu';
import { AFConfigContext } from '@/components/main/app.hooks';
import { i18nInstance } from '@/i18n/config';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';
import '@/styles/global.css';

const WORKSPACE = '00000000-0000-4000-8000-000000000010';
const DATABASE = '00000000-0000-4000-8000-000000000011';
const CONTAINER = '00000000-0000-4000-8000-000000000012';
const DASHBOARD = '00000000-0000-4000-8000-000000000013';
const USER = 'owned-clone-browser-fixture';
const doc = new Y.Doc({ guid: DATABASE }) as YDoc;

initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
saveGoTrueAuth(JSON.stringify({ access_token: 'test-owned-token', refresh_token: 'test-owned-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER } }));
setCurrentSession({ userId: USER, workspaceId: WORKSPACE });
updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), { status: 'available',
  info: { enable_page_history: true, enable_atomic_creation: true, enable_atomic_creation_defaults: true } });
i18nInstance.addResourceBundle('en', 'translation', en, true, true);
await i18nInstance.changeLanguage('en');
const persistence = new IndexeddbPersistence(DATABASE, doc);

await persistence.whenSynced;
const receiveRemote = async () => {
  const response = await fetch('/qa-owned-clone-state');

  Y.applyUpdate(doc, Uint8Array.from(await response.json()), 'remote');
};

await receiveRemote();
doc.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin !== 'remote') void fetch('/qa-owned-clone-sync', { method: 'POST', body: JSON.stringify(Array.from(update)) });
});
const context: DatabaseContextState = {
  databaseDoc: doc, databasePageId: CONTAINER, activeViewId: DASHBOARD, workspaceId: WORKSPACE,
  readOnly: false, canWrite: true, rowMap: {},
  createDatabaseView: (id, payload) => createDatabaseView(WORKSPACE, id, payload),
  loadViewMeta: async (id) => (await getAxios()!.get<{ data: View }>(`/api/workspace/${WORKSPACE}/view/${id}`)).data.data,
};

/** Render the real menu, provider, ownership hook, journal and HTTP boundary. Content rendering is outside this fixture. */
function FixtureWidget({ widgetId, viewId }: { widgetId: string; viewId: string }) {
  const { ownedViews } = useDashboardContext();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const source = (doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
    .get(YjsDatabaseKey.views).get(viewId);
  const name = String(source?.get(YjsDatabaseKey.name) ?? 'View');
  const value: WidgetContextValue = {
    widgetId, viewId, databaseId: DATABASE, name, icon: null, layout: ViewLayout.Grid,
    isEditing: true, canEdit: true, editing: true, mobileContext: false, searchActive: false,
    setSearchActive: () => undefined, showWidgetTitles: true, showIcon: false, headerHeight: 32,
    isDragging: false, setDragHandle: () => undefined, menuOpen: open, setMenuOpen: setOpen,
    settingsOpen: false, setSettingsOpen: () => undefined, getBoxElement: () => null,
    titleRef: opener, optionsRef: opener, settingsToolRef: opener,
    actions: { open: () => undefined, changeView: () => undefined, remove: () => undefined,
      move: () => undefined, openSettings: () => undefined, duplicate: () => void ownedViews.duplicateWidget(widgetId) },
  };

  return <WidgetContext.Provider value={value}>
    <section data-testid='clone-fixture-widget' data-view-id={viewId} style={{ margin: 12 }}>
      <WidgetMenu open={open} onOpenChange={setOpen}>
        <button ref={opener} aria-label={`Widget options ${name}`}>{name}</button>
      </WidgetMenu>
      <pre data-testid='clone-fixture-configuration'>{JSON.stringify(source?.toJSON())}</pre>
    </section>
  </WidgetContext.Provider>;
}

function Fixture() {
  const { rows } = useDashboardLayout();
  const [, setRevision] = useState(0);

  useEffect(() => {
    const update = () => setRevision((revision) => revision + 1);

    doc.on('update', update);
    return () => doc.off('update', update);
  }, []);
  return <>
    <button onClick={() => void receiveRemote()}>Receive remote changes</button>
    {rows.flatMap((row) => row.widgets).map((widget) =>
      <FixtureWidget key={widget.id} widgetId={widget.id} viewId={widget.viewId} />)}
    <Toaster />
  </>;
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter><AFConfigContext.Provider value={{ isAuthenticated: true, openLoginModal: () => undefined,
    updateCurrentUser: async () => undefined }}><DatabaseContext.Provider value={context}>
    <DashboardProvider><Fixture /></DashboardProvider>
  </DatabaseContext.Provider></AFConfigContext.Provider></MemoryRouter>
);
