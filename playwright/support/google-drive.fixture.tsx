import EventEmitter from 'events';

import axios from 'axios';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import en from '@/@types/translations/en.json';
import { initAPIService } from '@/application/services/js-services/http/core';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { getDocument, initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YDoc, YjsEditorKey, ViewLayout } from '@/application/types';
import { Editor } from '@/components/editor';
import { AFConfigContext } from '@/components/main/app.hooks';
import AppTheme from '@/components/main/AppTheme';
import { Toaster } from '@/components/ui/sonner';
import { i18nInstance } from '@/i18n/config';
import '@/styles/global.css';

initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
const requestInstance = axios.create({ baseURL: location.origin });
const query = new URLSearchParams(location.search);

localStorage.setItem(
  'token',
  JSON.stringify({
    access_token: 'drive-test',
    refresh_token: 'drive-test-refresh',
    expires_at: 4102444800,
    user: { id: 'drive-test-user' },
  })
);
const doc = new Y.Doc() as YDoc;
const saved = localStorage.getItem('drive-fixture');

if (saved) Y.applyUpdate(doc, new Uint8Array(JSON.parse(saved)));
else {
  initializeDocumentStructure(doc, true);
  const seed = query.get('seed');

  if (seed)
    slateContentInsertToYData(
      getDocument(doc.getMap(YjsEditorKey.data_section)).get(YjsEditorKey.page_id) as string,
      0,
      [JSON.parse(seed)],
      doc
    );
}

const events = new EventEmitter();
let editor: YjsEditor;

function Fixture() {
  const [readOnly, setReadOnly] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [ready, setReady] = useState(false);
  const [createdPage, setCreatedPage] = useState('');

  useEffect(() => {
    const update = () => {
      localStorage.setItem('drive-fixture', JSON.stringify([...Y.encodeStateAsUpdate(doc)]));
      setSnapshot(JSON.stringify(yDocToSlateContent(doc)?.children || []));
    };

    doc.on('update', update);
    update();
    return () => {
      doc.off('update', update);
    };
  }, []);
  return (
    <MemoryRouter>
      <AFConfigContext.Provider
        value={{ isAuthenticated: false, openLoginModal: () => undefined, updateCurrentUser: async () => undefined }}
      >
        <div
          className='min-h-screen bg-surface-primary text-text-primary'
          style={{ maxWidth: 900, margin: '0 auto', padding: 40 }}
        >
          <div className='mb-10 flex gap-3 text-sm'>
            <label>
              <input type='checkbox' checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
              Read only
            </label>
            <button onClick={() => (editor as YHistoryEditor).undo()}>Undo</button>
            <button onClick={() => (editor as YHistoryEditor).redo()}>Redo</button>
            <button
              onClick={() => {
                const node = editor.children.find((node) => 'type' in node && node.type === BlockType.GoogleDriveBlock);

                if (node && 'blockId' in node)
                  CustomEditor.setBlockData(editor, node.blockId!, { url: '', file_id: '', email: '', name: '' });
              }}
            >
              Clear Drive source
            </button>
            <button
              onClick={() => {
                const node = editor.children.find((node) => 'type' in node && node.type === BlockType.GoogleDriveBlock);

                if (node && 'blockId' in node)
                  CustomEditor.setBlockData(editor, node.blockId!, { caption: 'collaborator' });
              }}
            >
              Remote edit
            </button>
            <button
              onClick={() => {
                const node = editor.children.find((node) => 'type' in node && node.type === BlockType.GoogleDriveBlock);

                if (node && 'blockId' in node)
                  CustomEditor.setBlockData(editor, node.blockId!, {
                    url: 'https://docs.google.com/document/d/replacement-document/edit',
                    name: 'Replacement document',
                  });
              }}
            >
              Remote replace
            </button>
          </div>
          <Editor
            doc={doc}
            requestInstance={requestInstance}
            workspaceId='00000000-0000-4000-8000-000000000001'
            viewId='00000000-0000-4000-8000-000000000002'
            readOnly={readOnly}
            eventEmitter={events}
            addPage={async (_parent, payload) => {
              setCreatedPage(JSON.stringify(payload));
              return { view_id: 'drive-child-page' };
            }}
            loadViewMeta={async (id) => ({
              view_id: id,
              name: 'Drive test page',
              layout: ViewLayout.Document,
              icon: null,
              extra: null,
              children: [],
              is_published: false,
              is_private: false,
            })}
            onEditorConnected={(value) => {
              editor = value;
              setReady(true);
            }}
          />
          <output hidden data-testid='drive-created-page'>
            {createdPage}
          </output>
          <output hidden data-testid='drive-document-snapshot' data-ready={ready}>
            {snapshot}
          </output>
        </div>
        <Toaster />
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}

i18nInstance.addResourceBundle('en', 'translation', en, true, true);
void i18nInstance.changeLanguage('en').then(() =>
  createRoot(document.getElementById('root')!).render(
    <AppTheme>
      <Fixture />
    </AppTheme>
  )
);
