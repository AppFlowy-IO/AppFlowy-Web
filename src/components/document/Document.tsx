import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  generateUserColors,
  useDispatchClearAwareness,
  useDispatchCursorAwareness,
  useDispatchUserAwareness,
} from '@/application/awareness';
import { YjsEditor } from '@/application/slate-yjs';
import { appendFirstEmptyParagraph } from '@/application/slate-yjs/utils/yjs';
import { ViewComponentProps, YjsEditorKey, YSharedRoot } from '@/application/types';
import { getUserIconUrl } from '@/application/user-metadata';
import EditorSkeleton from '@/components/_shared/skeleton/EditorSkeleton';
import { useAppAwareness } from '@/components/app/app.hooks';
import { useCurrentUserWorkspaceAvatar } from '@/components/app/useWorkspaceMemberProfile';
import { Editor } from '@/components/editor';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import ViewMetaPreview from '@/components/view-meta/ViewMetaPreview';

export type DocumentProps = ViewComponentProps & {
  onEditorConnected?: (editor: YjsEditor) => void;
};

export const Document = (props: DocumentProps) => {
  const [search] = useSearchParams();
  const {
    doc,
    readOnly,
    viewMeta,
    isTemplateThumb,
    updatePage,
    onRendered,
    onEditorConnected,
    uploadFile,
    updatePageIcon,
    updatePageName,
  } = props;
  const blockId = search.get('blockId') || undefined;

  const awareness = useAppAwareness(viewMeta.viewId);
  const currentUser = useCurrentUser();
  const workspaceAvatar = useCurrentUserWorkspaceAvatar();
  const userAvatar = useMemo(() => getUserIconUrl(currentUser, workspaceAvatar), [currentUser, workspaceAvatar]);
  const service = useService();
  const dispatchUserAwareness = useDispatchUserAwareness(awareness);
  const dispatchCursorAwareness = useDispatchCursorAwareness(awareness);
  const { clearAwareness, clearCursor } = useDispatchClearAwareness(awareness);

  // Sync user information to awareness when component mounts or user changes
  useEffect(() => {
    if (!currentUser || !service || !awareness) return;

    const deviceId = service.getDeviceId();
    const colors = generateUserColors(currentUser.name || '');

    const userParams = {
      uid: Number(currentUser.uid),
      user_uuid: currentUser.uuid,
      device_id: deviceId,
      user_name: currentUser.name || 'Anonymous',
      cursor_color: colors.cursor_color,
      selection_color: colors.selection_color,
      user_avatar: userAvatar,
    };

    dispatchUserAwareness(userParams);
  }, [currentUser, service, awareness, dispatchUserAwareness, userAvatar]);

  // Clean up awareness when component unmounts
  useEffect(() => {
    return () => {
      clearAwareness();
    };
  }, [clearAwareness]);

  const onJumpedBlockId = useCallback(() => {
    // do nothing
  }, []);

  const document = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.document);

  const handleEnter = useCallback(
    (text: string) => {
      if (!doc) return;
      const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;

      appendFirstEmptyParagraph(sharedRoot, text);
    },
    [doc]
  );

  const ref = useRef<HTMLDivElement>(null);

  const handleRendered = useCallback(() => {
    if (onRendered) {
      onRendered();
    }

    const el = ref.current;

    if (!el) return;

    const scrollElement = el.closest('.MuiPaper-root');

    if (!scrollElement) {
      el.style.minHeight = `calc(100vh - 48px)`;
      return;
    }

    el.style.minHeight = `${scrollElement?.clientHeight - 64}px`;
  }, [onRendered]);

  const handleBlur = useCallback(() => {
    clearCursor(workspaceAvatar);
  }, [clearCursor, workspaceAvatar]);

  const handleSyncCursor = useCallback(
    (editor: YjsEditor) => {
      // Set up cursor synchronization when editor is connected
      if (currentUser && service && awareness) {
        const deviceId = service.getDeviceId();
        const colors = generateUserColors(currentUser.name || '');

        const userParams = {
          uid: Number(currentUser.uid),
          user_uuid: currentUser.uuid,
          device_id: deviceId,
          user_name: currentUser.name || 'Anonymous',
          cursor_color: colors.cursor_color,
          selection_color: colors.selection_color,
          user_avatar: userAvatar,
        };

        dispatchCursorAwareness(userParams, editor);
      }
    },
    [dispatchCursorAwareness, currentUser, service, awareness, userAvatar]
  );

  const handleEditorConnected = useCallback(
    (editor: YjsEditor) => {
      // Set up cursor synchronization when editor is connected
      handleSyncCursor(editor);
      // Call original onEditorConnected if provided
      if (onEditorConnected) {
        onEditorConnected(editor);
      }
    },
    [handleSyncCursor, onEditorConnected]
  );

  if (!document || !viewMeta.viewId) return null;

  return (
    <div ref={ref} className={'flex h-full w-full flex-col items-center'}>
      <ViewMetaPreview
        {...viewMeta}
        readOnly={readOnly}
        updatePage={updatePage}
        updatePageIcon={updatePageIcon}
        updatePageName={updatePageName}
        onEnter={readOnly ? undefined : handleEnter}
        maxWidth={952}
        uploadFile={uploadFile}
        onFocus={handleBlur}
      />
      <Suspense fallback={<EditorSkeleton />}>
        <div className={'relative flex w-full justify-center'}>
          <Editor
            viewId={viewMeta.viewId}
            readSummary={isTemplateThumb}
            jumpBlockId={blockId}
            onJumpedBlockId={onJumpedBlockId}
            onRendered={handleRendered}
            onEditorConnected={handleEditorConnected}
            onSelectionChange={handleSyncCursor}
            awareness={awareness}
            databaseRelations={viewMeta.database_relations}
            {...props}
          />
        </div>
      </Suspense>
    </div>
  );
};

export default Document;
