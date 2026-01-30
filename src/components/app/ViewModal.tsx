import { Button, Dialog, Divider, IconButton, Tooltip, Zoom } from '@mui/material';
import { TransitionProps } from '@mui/material/transitions';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { UIVariant, ViewComponentProps, ViewLayout, ViewMetaProps, YDoc } from '@/application/types';
import { getFirstChildView } from '@/application/view-utils';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/full_screen.svg';
import { findAncestors, findView } from '@/components/_shared/outline/utils';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';
import { useAppHandlers, useAppOutline, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import DatabaseView from '@/components/app/DatabaseView';
import MoreActions from '@/components/app/header/MoreActions';
import { useViewOperations, YDocWithMeta } from '@/components/app/hooks/useViewOperations';
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

/**
 * Minimal view metadata used as fallback when view is not yet in outline
 */
interface FallbackViewMeta {
  view_id: string;
  layout: ViewLayout;
  name: string;
}

function ViewModal({ viewId, open, onClose }: { viewId?: string; open: boolean; onClose: () => void }) {
  const workspaceId = useCurrentWorkspaceId();
  const { t } = useTranslation();
  const {
    toView,
    loadViewMeta,
    createRow,
    loadView,
    bindViewSync,
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
  const service = useService();
  const requestInstance = service?.getAxiosInstance();
  const { getViewReadOnlyStatus } = useViewOperations();

  // Document state
  const [doc, setDoc] = useState<{ id: string; doc: YDoc } | undefined>(undefined);
  const [notFound, setNotFound] = useState(false);
  const [syncBound, setSyncBound] = useState(false);

  // Fallback view metadata fetched from server (used when view not in outline yet)
  const [fallbackMeta, setFallbackMeta] = useState<FallbackViewMeta | null>(null);

  // Get view from outline
  const outlineView = useMemo(() => {
    if (!outline || !viewId) return undefined;
    return findView(outline, viewId);
  }, [outline, viewId]);

  // Compute effective view ID (for database containers, use first child)
  const effectiveViewId = useMemo(() => {
    if (!viewId) return undefined;

    // Try outline first, then fallback
    const meta = outlineView || fallbackMeta;

    if (meta) {
      const firstChild = getFirstChildView(meta as Parameters<typeof getFirstChildView>[0]);

      return firstChild?.view_id ?? viewId;
    }

    return viewId;
  }, [viewId, outlineView, fallbackMeta]);

  // Get effective view from outline
  const effectiveOutlineView = useMemo(() => {
    if (!outline || !effectiveViewId) return undefined;
    return findView(outline, effectiveViewId);
  }, [outline, effectiveViewId]);

  // Fetch fallback metadata when view not in outline
  useEffect(() => {
    // Skip if modal closed, view already in outline, or missing dependencies
    if (!open || effectiveOutlineView || !effectiveViewId || !workspaceId || !service) {
      // Clear fallback when no longer needed
      if (fallbackMeta && (effectiveOutlineView || !open)) {
        setFallbackMeta(null);
      }

      return;
    }

    let cancelled = false;

    service
      .getAppView(workspaceId, effectiveViewId)
      .then((fetchedView) => {
        if (!cancelled && fetchedView) {
          setFallbackMeta({
            view_id: fetchedView.view_id,
            layout: fetchedView.layout,
            name: fetchedView.name,
          });
        }
      })
      .catch((e) => {
        console.warn('[ViewModal] Failed to fetch view metadata for', effectiveViewId, e);
      });

    return () => {
      cancelled = true;
    };
  }, [open, effectiveOutlineView, effectiveViewId, workspaceId, service, fallbackMeta]);

  // Load document
  const loadPageDoc = useCallback(
    async (id: string) => {
      setNotFound(false);
      setDoc(undefined);
      setSyncBound(false);
      try {
        const loadedDoc = await loadView(id, false, true);

        setDoc({ doc: loadedDoc, id });
      } catch (e) {
        setNotFound(true);
        console.error('[ViewModal] Failed to load document:', e);
      }
    },
    [loadView]
  );

  useEffect(() => {
    if (open && effectiveViewId) {
      void loadPageDoc(effectiveViewId);
    }
  }, [open, effectiveViewId, loadPageDoc]);

  // Use outline view if available, otherwise use fallback
  const resolvedView = effectiveOutlineView || fallbackMeta;
  const layout = resolvedView?.layout ?? ViewLayout.Document;

  // Build viewMeta for the View component
  const viewMeta: ViewMetaProps | null = useMemo(() => {
    if (!resolvedView) return null;

    // When we have full outline view, use all properties
    if (effectiveOutlineView) {
      return {
        name: effectiveOutlineView.name,
        icon: effectiveOutlineView.icon || undefined,
        cover: effectiveOutlineView.extra?.cover || undefined,
        layout: effectiveOutlineView.layout,
        visibleViewIds: [],
        viewId: effectiveOutlineView.view_id,
        extra: effectiveOutlineView.extra,
        workspaceId,
      };
    }

    // Fallback with minimal properties
    return {
      name: resolvedView.name,
      icon: undefined,
      cover: undefined,
      layout: resolvedView.layout,
      visibleViewIds: [],
      viewId: resolvedView.view_id,
      extra: undefined,
      workspaceId,
    };
  }, [resolvedView, effectiveOutlineView, workspaceId]);

  const handleClose = useCallback(() => {
    setDoc(undefined);
    setSyncBound(false);
    setFallbackMeta(null);
    onClose();
  }, [onClose]);

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

  const handleUploadFile = useCallback(
    (file: File) => {
      if (resolvedView && uploadFile) {
        return uploadFile(resolvedView.view_id, file);
      }

      return Promise.reject();
    },
    [uploadFile, resolvedView]
  );

  const ref = useRef<HTMLDivElement | null>(null);
  const [movePageOpen, setMovePageOpen] = useState(false);

  const renderModalTitle = useCallback(() => {
    if (!effectiveViewId) return null;
    const space = findAncestors(outline || [], effectiveViewId)?.find((item) => item.extra?.is_space);

    return (
      <div
        className={'sticky top-0 z-[10] flex w-full items-center justify-between gap-2 bg-background-primary px-4 py-4'}
      >
        <div className={'flex items-center gap-4'}>
          <Tooltip title={t('tooltip.openAsPage')}>
            <IconButton
              size={'small'}
              onClick={async () => {
                await toView(effectiveViewId);
                handleClose();
              }}
            >
              <ExpandIcon className={'h-5 w-5 text-text-primary opacity-80'} />
            </IconButton>
          </Tooltip>
          <Divider orientation={'vertical'} className={'h-4'} />
          {space && ref.current && (
            <MovePagePopover
              viewId={effectiveViewId}
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
          <Users viewId={effectiveViewId} />
          <ShareButton viewId={effectiveViewId} />
          {ref.current && (
            <MoreActions
              menuContentProps={{
                container: ref.current,
                align: 'end',
              }}
              onDeleted={handleClose}
              viewId={effectiveViewId}
            />
          )}

          <Divider orientation={'vertical'} className={'h-4'} />
          <IconButton size={'small'} onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>
    );
  }, [effectiveViewId, handleClose, movePageOpen, outline, t, toView]);

  // Check if view is in shareWithMe and determine readonly status
  const isReadOnly = useMemo(() => {
    if (!effectiveViewId) return false;
    return getViewReadOnlyStatus(effectiveViewId, outline);
  }, [getViewReadOnlyStatus, effectiveViewId, outline]);

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
    createRow,
    loadView,
    bindViewSync,
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
      if (id === effectiveViewId && emails.includes(currentUser?.email || '')) {
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
  }, [eventEmitter, effectiveViewId, currentUser?.email]);

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
      {notFound ? <RecordNotFound viewId={effectiveViewId} /> : <div className={'h-full w-full'}>{viewDom}</div>}
    </Dialog>
  );
}

export default ViewModal;
