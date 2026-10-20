import EventEmitter from 'events';

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import * as Y from 'yjs';

import { initAPIService } from '@/application/services/js-services/http/core';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { initializeDocumentStructure, getDocument } from '@/application/slate-yjs/utils/yjs';
import { BlockType, CreatePagePayload, View, ViewLayout, YDoc, YjsEditorKey } from '@/application/types';
import { Editor } from '@/components/editor';
import AppTheme from '@/components/main/AppTheme';
import { AFConfigContext } from '@/components/main/app.hooks';
import { i18nInstance } from '@/i18n/config';
import en from '@/@types/translations/en.json';
import '@/styles/global.css';

initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
const doc = new Y.Doc() as YDoc;
const saved = localStorage.getItem('code-block-fixture');

if (saved) Y.applyUpdate(doc, new Uint8Array(JSON.parse(saved)));
else {
  initializeDocumentStructure(doc, true);
  const seed = new URLSearchParams(location.search).get('seed');

  if (seed) {
    const block = JSON.parse(seed);

    slateContentInsertToYData(
      getDocument(doc.getMap(YjsEditorKey.data_section)).get(YjsEditorKey.page_id) as string,
      0,
      [block],
      doc
    );
  }
}
const events = new EventEmitter();
let editor: YjsEditor;

function Fixture() {
  const [readOnly, setReadOnly] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [ready, setReady] = useState(false);
  const [createdPage, setCreatedPage] = useState<CreatePagePayload>();
  const [openedPage, setOpenedPage] = useState('');
  const [selectionInCode, setSelectionInCode] = useState(false);

  useEffect(() => {
    const update = () => {
      localStorage.setItem('code-block-fixture', JSON.stringify([...Y.encodeStateAsUpdate(doc)]));
      setSnapshot(JSON.stringify(yDocToSlateContent(doc)?.children ?? []));
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
          style={{ maxWidth: 900, margin: '0 auto', padding: 40, minHeight: '100vh' }}
        >
          <div className='mb-10 flex gap-3 text-sm'>
            <label>
              <input type='checkbox' checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
              Read only
            </label>
            <button onClick={() => (editor as YHistoryEditor).undo()}>Undo</button>
            <button onClick={() => (editor as YHistoryEditor).redo()}>Redo</button>
            <button>Outside</button>
            <button
              onClick={() => {
                const node = editor.children.find((node) => 'type' in node && node.type === BlockType.CodeBlock);

                if (node && 'blockId' in node) editor.insertText('collaborator', { at: editor.range([0, 0]) });
              }}
            >
              Remote edit
            </button>
          </div>
          <Editor
            doc={doc}
            workspaceId='00000000-0000-4000-8000-000000000001'
            viewId='00000000-0000-4000-8000-000000000002'
            readOnly={readOnly}
            eventEmitter={events}
            addPage={async (_parentId, payload) => {
              setCreatedPage(payload);
              return { view_id: 'code-child-page' };
            }}
            loadViewMeta={async (view_id) => ({ view_id, name: 'Code child page', layout: ViewLayout.Document } as View)}
            openPageModal={setOpenedPage}
            onEditorConnected={(value) => {
              editor = value;
              setReady(true);
            }}
            onSelectionChange={(value) =>
              setSelectionInCode(!!value.selection && getBlockEntry(value)?.[0].type === BlockType.CodeBlock)
            }
          />
          <output hidden data-testid='code-document-snapshot' data-ready={ready} data-selection-in-code={selectionInCode}>
            {snapshot}
          </output>
          <output hidden data-testid='code-created-page'>
            {JSON.stringify(createdPage)}
          </output>
          <output hidden data-testid='code-opened-page'>
            {openedPage}
          </output>
        </div>
      </AFConfigContext.Provider>
    </MemoryRouter>
  );
}

i18nInstance.addResourceBundle('en', 'translation', en, true, true);
void i18nInstance.changeLanguage('en').then(() =>
  createRoot(document.getElementById('root')!).render(
    <AppTheme>
      <div data-testid='code-page-scroll' className='h-screen overflow-y-auto bg-surface-primary text-text-primary'>
        <Fixture />
        <Toaster />
      </div>
    </AppTheme>
  )
);
