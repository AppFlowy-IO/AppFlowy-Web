import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import smoothScrollIntoViewIfNeeded from 'smooth-scroll-into-view-if-needed';

import { YjsEditor } from '@/application/slate-yjs';
import { UIVariant, ViewMetaProps, YDoc, YDocWithMeta } from '@/application/types';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { insertDataToDoc } from '@/components/ai-chat/utils';
import {
  useAppOperations,
  useAppView,
  useCurrentWorkspaceId,
  useOpenPageModal,
  useLoadViews,
} from '@/components/app/app.hooks';
import { Document } from '@/components/document';
import RecordNotFound from '@/components/error/RecordNotFound';
import { getAxiosInstance } from '@/application/services/js-services/http';

function DrawerContent({ openViewId }: { openViewId: string }) {
  const {
    toView,
    loadViewMeta,
    createRow,
    loadView,
    updatePage,
    addPage,
    deletePage,
    restorePage,
    loadTrashViews,
    movePage,
    duplicatePage,
    setWordCount,
    uploadFile,
    bindViewSync,
  } = useAppOperations();
  const openPageModal = useOpenPageModal();
  const loadViews = useLoadViews();
  const { getInsertData, clearInsertData, drawerOpen } = useAIChatContext();

  const workspaceId = useCurrentWorkspaceId();
  // Each visit owns its result, including returning to the same source after navigation.
  const source = useMemo(
    () => ({ workspaceId, viewId: openViewId, loadView, active: false }),
    [workspaceId, openViewId, loadView]
  );
  const [loadedSource, setLoadedSource] = useState<{
    source: typeof source;
    doc?: YDoc;
    notFound?: boolean;
  }>();
  const currentSource = loadedSource?.source === source ? loadedSource : undefined;
  const loadedDoc = currentSource?.doc;
  const doc = loadedDoc && (loadedDoc.view_id ?? loadedDoc.object_id) === openViewId ? loadedDoc : undefined;
  const requestInstance = getAxiosInstance();
  const initialScrolling = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [connectedEditor, setConnectedEditor] = useState<{ source: typeof source; doc: YDoc; editor: YjsEditor }>();
  const editor = connectedEditor?.source === source && connectedEditor.doc === doc ? connectedEditor.editor : undefined;
  const [syncBoundDoc, setSyncBoundDoc] = useState<YDoc>();

  const onEditorConnected = useCallback(
    (editor: YjsEditor) => {
      if (doc && source.active) {
        setConnectedEditor({ source, doc, editor });
      }
    },
    [source, doc]
  );

  const view = useAppView(openViewId);

  useEffect(() => {
    if (!source.workspaceId || !source.viewId) return;
    const controller = new AbortController();

    source.active = true;
    initialScrolling.current = false;
    setConnectedEditor(undefined);
    void source
      .loadView(source.viewId, false, false, { signal: controller.signal })
      .then((doc) => {
        if (!controller.signal.aborted) setLoadedSource({ source, doc });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoadedSource({ source, notFound: true });
        console.error(error);
      });

    return () => {
      source.active = false;
      controller.abort();
    };
  }, [source]);

  useEffect(() => {
    if (!doc || !bindViewSync || syncBoundDoc === doc) return;

    const docWithMeta = doc as YDocWithMeta;
    const docViewId = docWithMeta.view_id ?? docWithMeta.object_id;

    if (docViewId !== openViewId) {
      return;
    }

    if (docWithMeta._syncBound) {
      setSyncBoundDoc(doc);
      return;
    }

    const syncContext = bindViewSync(doc);

    if (syncContext) {
      setSyncBoundDoc(doc);
    }
  }, [doc, bindViewSync, syncBoundDoc, openViewId]);

  useEffect(() => {
    const insertData = getInsertData(openViewId);

    if (!doc || !insertData || !drawerOpen || editor === undefined) {
      return;
    }

    try {
      editor.deselect();
      insertDataToDoc(doc, insertData);

      clearInsertData(openViewId);
    } catch (e) {
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

  const viewMeta: ViewMetaProps | null = useMemo(() => {
    return view
      ? {
          name: view.name,
          icon: view.icon || undefined,
          cover: view.extra?.cover || undefined,
          layout: view.layout,
          visibleViewIds: [],
          viewId: view.view_id,
          extra: view.extra,
          workspaceId,
        }
      : null;
  }, [view, workspaceId]);

  const handleUploadFile = useCallback(
    (file: File, onProgress?: (progress: number) => void) => {
      if (view && uploadFile) {
        return uploadFile(view.view_id, file, onProgress);
      }

      return Promise.reject();
    },
    [uploadFile, view]
  );

  if (currentSource?.notFound) {
    return <RecordNotFound viewId={openViewId} />;
  }

  return (
    <div ref={containerRef} className={'ai-chat-view relative h-fit w-full'}>
      {doc && viewMeta?.viewId === openViewId && (
        <Document
          requestInstance={requestInstance}
          workspaceId={workspaceId || ''}
          doc={doc}
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
          restorePage={restorePage}
          loadTrashViews={loadTrashViews}
          movePage={movePage}
          duplicatePage={duplicatePage}
          openPageModal={openPageModal}
          loadViews={loadViews}
          onWordCountChange={setWordCount}
          uploadFile={handleUploadFile}
          variant={UIVariant.App}
          onEditorConnected={onEditorConnected}
        />
      )}
    </div>
  );
}

export default DrawerContent;
