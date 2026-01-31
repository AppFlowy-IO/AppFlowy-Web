import { debounce } from 'lodash-es';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import smoothScrollIntoViewIfNeeded from 'smooth-scroll-into-view-if-needed';

import { YjsEditor } from '@/application/slate-yjs';
import { UIVariant, ViewMetaProps, YDoc } from '@/application/types';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { insertDataToDoc } from '@/components/ai-chat/utils';
import { useAppHandlers, useAppView, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { YDocWithMeta } from '@/components/app/hooks/useViewOperations';
import { Document } from '@/components/document';
import RecordNotFound from '@/components/error/RecordNotFound';
import { useService } from '@/components/main/app.hooks';

function DrawerContent({
  openViewId,
}: {
  openViewId: string;
}) {
  const {
    toView,
    loadViewMeta,
    createRow,
    loadView,
    updatePage,
    addPage,
    deletePage,
    openPageModal,
    loadViews,
    setWordCount,
    uploadFile,
    bindViewSync,
  } = useAppHandlers();
  const {
    getInsertData,
    clearInsertData,
    drawerOpen,
  } = useAIChatContext();

  const [doc, setDoc] = React.useState<{
    id: string;
    doc: YDoc;
  } | undefined>(undefined);
  const service = useService();
  const requestInstance = service?.getAxiosInstance();
  const initialScrolling = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [editor, setEditor] = useState<YjsEditor | undefined>(undefined);
  const [syncBound, setSyncBound] = useState(false);

  const onEditorConnected = useCallback((editor: YjsEditor) => {
    setEditor(editor);
  }, []);

  const loadPageDoc = useCallback(async(id: string) => {
    setNotFound(false);
    setDoc(undefined);
    setSyncBound(false);
    try {
      const doc = await loadView(id);

      setDoc({ doc, id });
    } catch(e) {
      setNotFound(true);
      console.error(e);
    }

  }, [loadView]);

  const view = useAppView(openViewId);

  useEffect(() => {
    if (openViewId) {
      void loadPageDoc(openViewId);
    } else {
      setDoc(undefined);
      setSyncBound(false);
    }
  }, [openViewId, loadPageDoc]);

  useEffect(() => {
    if (!doc || !bindViewSync || syncBound) return;

    const docWithMeta = doc.doc as YDocWithMeta;

    if (docWithMeta.object_id !== doc.id) {
      return;
    }

    if (docWithMeta._syncBound) {
      setSyncBound(true);
      return;
    }

    const syncContext = bindViewSync(doc.doc);

    if (syncContext) {
      setSyncBound(true);
    }
  }, [doc, bindViewSync, syncBound]);

  useEffect(() => {
    const insertData = getInsertData(openViewId);

    if(!doc || !insertData || !drawerOpen || doc.id !== openViewId || editor === undefined) {
      return;
    }

    try {
      editor.deselect();
      insertDataToDoc(doc.doc, insertData);

      clearInsertData(openViewId);
    } catch(e) {
      console.error(e);
    }

    initialScrolling.current = true;

  }, [editor, clearInsertData, doc, getInsertData, openViewId, drawerOpen]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const debounceStopScrolling = debounce(() => {
      initialScrolling.current = false;
    }, 500);

    const observer = new MutationObserver(() => {
      if (!initialScrolling.current) {
        return;
      }

      const textBox = container.querySelector('[role="textbox"]');

      if (textBox) {
        void smoothScrollIntoViewIfNeeded(textBox, {
          behavior: 'smooth',
          block: 'end',
          onScrollChange: () => {
            debounceStopScrolling();
          },
        });

        // focus to end of the text
        const range = document.createRange();

        range.selectNodeContents(textBox);
        range.collapse(false);
        const selection = window.getSelection();

        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      debounceStopScrolling.cancel();
    };
  }, []);

  const workspaceId = useCurrentWorkspaceId();
  const viewMeta: ViewMetaProps | null = useMemo(() => {
    return view ? {
      name: view.name,
      icon: view.icon || undefined,
      cover: view.extra?.cover || undefined,
      layout: view.layout,
      visibleViewIds: [],
      viewId: view.view_id,
      extra: view.extra,
      workspaceId,
    } : null;
  }, [view, workspaceId]);

  const handleUploadFile = useCallback((file: File, onProgress?: (progress: number) => void) => {
    if(view && uploadFile) {
      return uploadFile(view.view_id, file, onProgress);
    }

    return Promise.reject();
  }, [uploadFile, view]);

  if(notFound) {
    return (
      <RecordNotFound viewId={openViewId} />
    );
  }

  return (
    <div ref={containerRef} className={'h-fit w-full relative ai-chat-view'}>
      {
        doc && viewMeta && (
          <Document
            requestInstance={requestInstance}
            workspaceId={workspaceId || ''}
            doc={doc.doc}
            readOnly={false}
            viewMeta={viewMeta}
            navigateToView={toView}
            loadViewMeta={loadViewMeta}
            createRow={createRow}
            loadView={loadView}
            bindViewSync={bindViewSync}
            updatePage={updatePage}
            addPage={addPage}
            deletePage={deletePage}
            openPageModal={openPageModal}
            loadViews={loadViews}
            onWordCountChange={setWordCount}
            uploadFile={handleUploadFile}
            variant={UIVariant.App}
            onEditorConnected={onEditorConnected}
          />
        )
      }

    </div>
  );
}

export default DrawerContent;
