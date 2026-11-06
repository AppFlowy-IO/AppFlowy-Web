import EventEmitter from 'events';

import axios from 'axios';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import en from '@/@types/translations/en.json';
import { ERROR_CODE } from '@/application/constants';
import { initAPIService } from '@/application/services/js-services/http/core';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { getDocument, initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import { BlockType, UIVariant, View, ViewIconType, ViewLayout, YDoc, YjsEditorKey } from '@/application/types';
import { Editor } from '@/components/editor';
import { AFConfigContext } from '@/components/main/app.hooks';
import AppTheme from '@/components/main/AppTheme';
import { Toaster } from '@/components/ui/sonner';
import { i18nInstance } from '@/i18n/config';
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
const backgroundDoc = new Y.Doc() as YDoc;

initializeDocumentStructure(backgroundDoc, true);
const saved = localStorage.getItem('image-fixture');

if (saved) Y.applyUpdate(doc, new Uint8Array(JSON.parse(saved)));
else {
  initializeDocumentStructure(doc, true);
  const seed =
    new URLSearchParams(location.search).get('seed') ||
    (location.pathname.endsWith('image-preview.html')
      ? JSON.stringify({
          type: BlockType.ImageBlock,
          data: {
            url: new URL('/playwright/fixtures/images/design.png', location.origin).href,
            source: 'network',
            name: 'Design image',
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

const linkPage = (view_id: string, name: string, overrides: Partial<View> = {}): View => ({
  view_id,
  name,
  icon: null,
  layout: ViewLayout.Document,
  extra: null,
  children: [],
  is_published: false,
  is_private: false,
  ...overrides,
});
const recentLinkPages = [
  linkPage('science', 'CSC - IT Center for Science Ltd'),
  linkPage('weekly', 'Weekly sync', { icon: { ty: ViewIconType.Emoji, value: '⚡' } }),
  linkPage('list', 'List', { layout: ViewLayout.List }),
  linkPage('crisp', 'Crisp BV'),
  linkPage('payfit', "Payfit Followup from Annie's suggestions"),
  linkPage('older', 'Older page'),
];
const loadLinkViews = async (variant?: UIVariant) =>
  variant === UIVariant.Recent
    ? [linkPage('00000000-0000-4000-8000-000000000002', 'Current page'), ...recentLinkPages]
    : [
        linkPage('general', 'General', {
          is_space: true,
          children: [...recentLinkPages, linkPage('linked-page', 'Design reference')],
        }),
      ];

function Fixture() {
  const [readOnly, setReadOnly] = useState(query.has('read-only'));
  const [snapshot, setSnapshot] = useState('');
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [createdPage, setCreatedPage] = useState('');
  const [openedPage, setOpenedPage] = useState('');

  useEffect(() => {
    const update = (event: Event) => {
      const node = editor?.children.find((node) => 'type' in node && node.type === BlockType.ImageBlock);

      if (node && 'blockId' in node && node.blockId)
        CustomEditor.setBlockData(editor, node.blockId, (event as CustomEvent).detail);
    };

    document.addEventListener('test-image-update', update);
    return () => document.removeEventListener('test-image-update', update);
  }, []);

  useEffect(() => {
    const update = () => {
      localStorage.setItem('image-fixture', JSON.stringify([...Y.encodeStateAsUpdate(doc)]));
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
          {query.has('two-editors') && (
            <div data-testid='background-editor'>
              <Editor
                doc={backgroundDoc}
                requestInstance={requestInstance}
                workspaceId='workspace'
                viewId='background'
                readOnly={false}
                uploadFile={async () => {
                  throw new Error('The background editor must not receive this drop');
                }}
              />
            </div>
          )}
          <div className='mb-10 flex gap-3 text-sm'>
            <label>
              <input type='checkbox' checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
              Read only
            </label>
            <button onClick={() => (editor as YHistoryEditor).undo()}>Undo</button>
            <button onClick={() => (editor as YHistoryEditor).redo()}>Redo</button>
            <button
              onClick={async () => {
                const bytes = await (await fetch('/fixtures/pasted.png')).blob();
                const clipboard = new DataTransfer();

                clipboard.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
                let index = editor.children.findIndex((node) => 'type' in node && node.type === BlockType.Paragraph);

                if (index < 0) {
                  const last = editor.children[editor.children.length - 1];

                  if (!last || !('blockId' in last) || !last.blockId) return;
                  const id = CustomEditor.addBelowBlock(editor, last.blockId, BlockType.Paragraph, {});

                  index = editor.children.findIndex((node) => 'blockId' in node && node.blockId === id);
                }

                editor.select(editor.start([index]));
                editor.insertData(clipboard);
              }}
            >
              Paste image
            </button>
            <button
              onClick={() => {
                const node = editor.children.find((node) => 'type' in node && node.type === BlockType.ImageBlock);

                if (node && 'blockId' in node)
                  CustomEditor.setBlockData(editor, node.blockId!, { caption: 'collaborator' });
              }}
            >
              Remote edit
            </button>
          </div>
          <button onClick={() => setMounted((value) => !value)}>Toggle editor</button>
          <div data-testid='image-editor-host' style={query.has('offscreen') ? { marginTop: 2000 } : undefined}>
            {mounted && (
              <Editor
                doc={doc}
                requestInstance={requestInstance}
                workspaceId='00000000-0000-4000-8000-000000000001'
                viewId='00000000-0000-4000-8000-000000000002'
                readOnly={readOnly}
                loadViews={loadLinkViews}
                openPageModal={query.has('navigation-only') ? undefined : setOpenedPage}
                navigateToView={async (id) => setOpenedPage(id)}
                eventEmitter={events}
                uploadFile={async (file) => {
                  if (query.has('controlled-upload')) {
                    const response = await fetch('/fixtures/upload', {
                      method: 'POST',
                      body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
                    });

                    if (!response.ok)
                      throw Object.assign(new Error('Upload rejected'), await response.json().catch(() => ({})));
                    return (await response.json()).url;
                  }

                  await new Promise((resolve) => setTimeout(resolve, 300));
                  if (query.has('quota'))
                    throw Object.assign(new Error('Upload size limit exceeded'), {
                      code: ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED,
                      sourceDomain: 'appflowy.server',
                    });
                  return location.pathname.endsWith('image-preview.html')
                    ? URL.createObjectURL(file)
                    : new URL(`/fixtures/${file.name}`, location.href).href;
                }}
                addPage={async (_parent, payload) => {
                  setCreatedPage(JSON.stringify(payload));
                  return { view_id: 'image-child-page' };
                }}
                onEditorConnected={(value) => {
                  editor = value;
                  setReady(true);
                }}
              />
            )}
          </div>
          <output hidden data-testid='image-created-page'>
            {createdPage}
          </output>
          <output hidden data-testid='image-opened-page'>
            {openedPage}
          </output>
          <output hidden data-testid='image-document-snapshot' data-ready={ready}>
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
      <div className='min-h-screen bg-surface-primary text-text-primary' style={{ minHeight: '100vh' }}>
        <Fixture />
        <Toaster />
      </div>
    </AppTheme>
  )
);
