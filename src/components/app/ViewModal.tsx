import { Button, Dialog, Divider, IconButton, Tooltip, Zoom } from '@mui/material';
import { TransitionProps } from '@mui/material/transitions';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { UIVariant, ViewComponentProps, ViewLayout, ViewMetaProps, YDoc } from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/full_screen.svg';
import { findAncestors, findView } from '@/components/_shared/outline/utils';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';
import { useAppHandlers, useAppOutline, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import DatabaseView from '@/components/app/DatabaseView';
import MoreActions from '@/components/app/header/MoreActions';
import { useViewOperations } from '@/components/app/hooks/useViewOperations';
import MovePagePopover from '@/components/app/view-actions/MovePagePopover';
import { Document } from '@/components/document';
import RecordNotFound from '@/components/error/RecordNotFound';
import { useCurrentUser, useService } from '@/components/main/app.hooks';

import ShareButton from 'src/components/app/share/ShareButton';

import { Users } from './header/Users';

const Transition = React.forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement;
  },
  ref: React.Ref<unknown>
) {
  return <Zoom ref={ref} {...props} />;
});

function ViewModal({ viewId, open, onClose }: { viewId?: string; open: boolean; onClose: () => void }) {
  const workspaceId = useCurrentWorkspaceId();

  const { t } = useTranslation();
  const {
    toView,
    loadViewMeta,
    createRowDoc,
    loadView,
    updatePage,
    addPage,
    deletePage,
    openPageModal,
    loadViews,
    setWordCount,
    uploadFile,
    eventEmitter,
    ...handlers
  } = useAppHandlers();
  const outline = useAppOutline();
  const { getViewReadOnlyStatus } = useViewOperations();
  const [doc, setDoc] = React.useState<
    | {
        id: string;
        doc: YDoc;
      }
    | undefined
  >(undefined);
  const [notFound, setNotFound] = React.useState(false);
  const service = useService();
  const requestInstance = service?.getAxiosInstance();
  const loadPageDoc = useCallback(
    async (id: string) => {
      setNotFound(false);
      setDoc(undefined);
      try {
        const doc = await loadView(id, false, true);

        setDoc({ doc, id });
      } catch (e) {
        setNotFound(true);
        console.error(e);
      }
    },
    [loadView]
  );

  useEffect(() => {
    if (open && viewId) {
      void loadPageDoc(viewId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewId]);

  const handleClose = useCallback(() => {
    setDoc(undefined);
    onClose();
  }, [onClose]);

  const view = useMemo(() => {
    if (!outline || !viewId) return;
    return findView(outline, viewId);
  }, [outline, viewId]);

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
    (file: File) => {
      if (view && uploadFile) {
        return uploadFile(view.view_id, file);
      }

      return Promise.reject();
    },
    [uploadFile, view]
  );

  const ref = useRef<HTMLDivElement | null>(null);
  const [movePageOpen, setMovePageOpen] = React.useState(false);
  const renderModalTitle = useCallback(() => {
    if (!viewId) return null;
    const space = findAncestors(outline || [], viewId)?.find((item) => item.extra?.is_space);

    return (
      <div
        className={'sticky top-0 z-[10] flex w-full items-center justify-between gap-2 bg-background-primary px-4 py-4'}
      >
        <div className={'flex items-center gap-4'}>
          <Tooltip title={t('tooltip.openAsPage')}>
            <IconButton
              size={'small'}
              onClick={async () => {
                await toView(viewId);
                handleClose();
              }}
            >
              <ExpandIcon className={'h-5 w-5 text-text-primary opacity-80'} />
            </IconButton>
          </Tooltip>
          <Divider orientation={'vertical'} className={'h-4'} />
          {space && ref.current && (
            <MovePagePopover
              viewId={viewId}
              open={movePageOpen}
              onOpenChange={setMovePageOpen}
              onMoved={() => {
                setMovePageOpen(false);
              }}
            >
              <Button
                size={'small'}
                startIcon={
                  <SpaceIcon
                    bgColor={space.extra?.space_icon_color}
                    value={space.extra?.space_icon || ''}
                    char={space.extra?.space_icon ? undefined : space.name.slice(0, 1)}
                  />
                }
                color={'inherit'}
                className={'justify-start px-1.5'}
                endIcon={<ArrowDownIcon />}
              >
                {space.name}
              </Button>
            </MovePagePopover>
          )}
        </div>

        <div className={'flex items-center gap-4'}>
          <Users viewId={viewId} />
          <ShareButton viewId={viewId} />
          {ref.current && (
            <MoreActions
              menuContentProps={{
                container: ref.current,
                align: 'end',
              }}
              onDeleted={handleClose}
              viewId={viewId}
            />
          )}

          <Divider orientation={'vertical'} className={'h-4'} />
          <IconButton size={'small'} onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>
    );
  }, [handleClose, movePageOpen, outline, t, toView, viewId]);

  const layout = view?.layout || ViewLayout.Document;

  // Check if view is in shareWithMe and determine readonly status
  const isReadOnly = useMemo(() => {
    if (!viewId) return false;
    return getViewReadOnlyStatus(viewId, outline);
  }, [getViewReadOnlyStatus, viewId, outline]);

  const View = useMemo(() => {
    switch (layout) {
      case ViewLayout.Document:
        return Document;
      case ViewLayout.Grid:
      case ViewLayout.Board:
      case ViewLayout.Calendar:
        return DatabaseView;
      default:
        return null;
    }
  }, [layout]) as React.FC<ViewComponentProps>;

  const viewDom = useMemo(() => {
    if (!doc || !viewMeta || doc.id !== viewMeta.viewId) return null;
    return (
      <View
        requestInstance={requestInstance}
        workspaceId={workspaceId || ''}
        doc={doc.doc}
        readOnly={isReadOnly}
        viewMeta={viewMeta}
        navigateToView={toView}
        loadViewMeta={loadViewMeta}
        createRowDoc={createRowDoc}
        loadView={loadView}
        updatePage={updatePage}
        addPage={addPage}
        deletePage={deletePage}
        openPageModal={openPageModal}
        loadViews={loadViews}
        onWordCountChange={setWordCount}
        uploadFile={handleUploadFile}
        variant={UIVariant.App}
        {...handlers}
      />
    );
  }, [
    doc,
    viewMeta,
    View,
    requestInstance,
    workspaceId,
    isReadOnly,
    toView,
    loadViewMeta,
    createRowDoc,
    loadView,
    updatePage,
    addPage,
    deletePage,
    openPageModal,
    loadViews,
    setWordCount,
    handleUploadFile,
    handlers,
  ]);

  const currentUser = useCurrentUser();

  useEffect(() => {
    const handleShareViewsChanged = ({ emails, viewId: id }: { emails: string[]; viewId: string }) => {
      if (id === viewId && emails.includes(currentUser?.email || '')) {
        toast.success('Permission changed');
      }
    };

    if (eventEmitter) {
      eventEmitter.on(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
    }

    return () => {
      if (eventEmitter) {
        eventEmitter.off(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
      }
    };
  }, [eventEmitter, viewId, currentUser?.email]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth={true}
      keepMounted={false}
      disableAutoFocus={true}
      disableEnforceFocus={false}
      disableRestoreFocus={true}
      disableScrollLock={true}
      disablePortal={false}
      TransitionComponent={Transition}
      PaperProps={{
        ref,
        className: `max-w-[70vw] appflowy-scroll-container transform relative w-[1188px] flex flex-col h-[80vh] appflowy-scroller`,
      }}
    >
      {renderModalTitle()}
      {notFound ? <RecordNotFound viewId={viewId} /> : <div className={'h-full w-full'}>{viewDom}</div>}
    </Dialog>
  );
}

export default ViewModal;
