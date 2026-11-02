import axios from 'axios';
import EventEmitter from 'events';

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { initAPIService } from '@/application/services/js-services/http/core';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { getDocument, initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YDoc, YjsEditorKey } from '@/application/types';
import { ERROR_CODE } from '@/application/constants';
import { Editor } from '@/components/editor';
import AppTheme from '@/components/main/AppTheme';
import { AFConfigContext } from '@/components/main/app.hooks';
import { Toaster } from '@/components/ui/sonner';
import { i18nInstance } from '@/i18n/config';
import en from '@/@types/translations/en.json';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';
import '@/styles/global.css';

initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });
const requestInstance = axios.create({ baseURL: location.origin });
const query = new URLSearchParams(location.search);
if (query.has('quota'))
  updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
    status: 'available',
    info: { self_hosted: query.get('quota') === 'self-hosted' } as never,
  });
const doc = new Y.Doc() as YDoc;
const saved = localStorage.getItem('pdf-fixture');

if (saved) Y.applyUpdate(doc, new Uint8Array(JSON.parse(saved)));
else {
  initializeDocumentStructure(doc, true);
  const seed =
    new URLSearchParams(location.search).get('seed') ||
    (location.pathname.endsWith('pdf-preview.html')
      ? JSON.stringify({
          type: BlockType.PDFBlock,
          data: {
            url: new URL('/playwright/fixtures/pdfs/sample.pdf', location.origin).href,
            url_type: 'network',
            name: 'Sample PDF',
          },
          children: [{ type: 'text', children: [{ text: '' }] }],
        })
      : null);
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
      localStorage.setItem('pdf-fixture', JSON.stringify([...Y.encodeStateAsUpdate(doc)]));
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
          style={{ maxWidth: query.has('design') ? 808 : 900, margin: '0 auto', padding: 40 }}
        >
          <div className='mb-10 flex gap-3 text-sm'>
            <label>
              <input type='checkbox' checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
              Read only
            </label>
            <button onClick={() => (editor as YHistoryEditor).undo()}>Undo</button>
            <button onClick={() => (editor as YHistoryEditor).redo()}>Redo</button>
            <button onClick={() => {
              const clipboard = new DataTransfer();

              clipboard.items.add(new File(['pdf'], 'pasted.pdf', { type: 'application/pdf' }));
              editor.select(editor.start([0]));
              editor.insertData(clipboard);
            }}>Paste PDF</button>
            <button
              onClick={() => {
                const node = editor.children.find((node) => 'type' in node && node.type === BlockType.PDFBlock);

                if (node && 'blockId' in node)
                  CustomEditor.setBlockData(editor, node.blockId!, { caption: 'collaborator' });
              }}
            >
              Remote edit
            </button>
          </div>
          <Editor
            doc={doc}
            requestInstance={requestInstance}
            workspaceId='00000000-0000-4000-8000-000000000001'
            viewId='00000000-0000-4000-8000-000000000002'
            readOnly={readOnly}
            eventEmitter={events}
            uploadFile={async (file) => {
              if (query.has('controlled-upload')) {
                const response = await fetch('/fixtures/upload', { method: 'POST' });

                if (!response.ok) throw new Error('Upload rejected');
                return (await response.json()).url;
              }
              await new Promise((resolve) => setTimeout(resolve, 300));
              if (query.has('quota'))
                throw { code: ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED, sourceDomain: 'appflowy.server' };
              return location.pathname.endsWith('pdf-preview.html')
                ? URL.createObjectURL(file)
                : new URL(`/fixtures/${file.name}`, location.href).href;
            }}
            addPage={async (_parent, payload) => {
              setCreatedPage(JSON.stringify(payload));
              return { view_id: 'pdf-child-page' };
            }}
            onEditorConnected={(value) => {
              editor = value;
              setReady(true);
            }}
          />
          <output hidden data-testid='pdf-created-page'>
            {createdPage}
          </output>
          <output hidden data-testid='pdf-document-snapshot' data-ready={ready}>
            {snapshot}
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
      <div className='min-h-screen bg-surface-primary text-text-primary'>
        <Fixture />
        {query.has('image-hover') && <Toaster />}
      </div>
    </AppTheme>
  )
);
