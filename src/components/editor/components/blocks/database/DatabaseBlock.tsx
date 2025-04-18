import { UIVariant, View, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { Database } from '@/components/database';
import { DatabaseNode, EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { getScrollParent } from '@/components/global-comment/utils';
import CircularProgress from '@mui/material/CircularProgress';
import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';
import { Element } from 'slate';

export const DatabaseBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<DatabaseNode>>(({ node, children, ...attributes }, ref) => {
    const { t } = useTranslation();
    const viewId = node.data.view_id;
    const context = useEditorContext();
    const workspaceId = context.workspaceId;
    const navigateToView = context?.navigateToView;
    const loadView = context?.loadView;
    const createRowDoc = context?.createRowDoc;
    const loadViewMeta = context?.loadViewMeta;
    const variant = context.variant;

    const [notFound, setNotFound] = useState(false);
    const [showActions, setShowActions] = useState(false);
    const [doc, setDoc] = useState<YDoc | null>(null);

    useEffect(() => {
      if (!viewId) return;
      void (async () => {
        try {
          const view = await loadView?.(viewId);

          if (!view) {
            throw new Error('View not found');
          }

          setDoc(view);
        } catch (e) {
          setNotFound(true);
        }
      })();
    }, [viewId, loadView]);

    const [selectedViewId, setSelectedViewId] = useState<string>(viewId);
    const [visibleViewIds, setVisibleViewIds] = useState<string[]>([]);
    const [iidName, setIidName] = useState<string>('');

    useEffect(() => {
      const updateVisibleViewIds = async (meta: View | null) => {
        if (!meta) {
          return;
        }

        const viewIds = meta.children.map((v) => v.view_id) || [];

        viewIds.unshift(meta.view_id);

        if (!viewIds.includes(viewId)) {
          setSelectedViewId(viewIds[0]);
        } else {
          setSelectedViewId(viewId);
        }

        setIidName(meta.name);
        setVisibleViewIds(viewIds);
      };

      void (async () => {
        try {
          const meta = await loadViewMeta?.(viewId, updateVisibleViewIds);

          if (meta) {
            await updateVisibleViewIds(meta);
          }
        } catch (e) {
          setNotFound(true);
        }
      })();
    }, [loadViewMeta, viewId]);

    const handleNavigateToRow = useCallback(
      async (rowId: string) => {
        if (!viewId) return;
        await navigateToView?.(viewId, rowId);
      },
      [navigateToView, viewId],
    );
    const editor = useSlateStatic();
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const selectedView = useMemo(() => {
      const database = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database);

      return database?.get(YjsDatabaseKey.views)?.get(selectedViewId);
    }, [doc, selectedViewId]);

    const [paddingStart, setPaddingStart] = useState(0);
    const [paddingEnd, setPaddingEnd] = useState(0);
    const [width, setWidth] = useState(0);

    useEffect(() => {

      const dom = ReactEditor.toDOMNode(editor, node);

      const scrollContainer = dom.closest('.appflowy-scroll-container') || getScrollParent(dom) as HTMLElement;

      if (!dom || !scrollContainer) return;

      const onResize = () => {
        const rect = scrollContainer.getBoundingClientRect();
        const blockRect = dom.getBoundingClientRect();

        const offsetLeft = blockRect.left - rect.left;
        const offsetRight = rect.right - blockRect.right;

        setWidth(rect.width);
        setPaddingStart(offsetLeft);
        setPaddingEnd(offsetRight);
      };

      onResize();

      const resizeObserver = new ResizeObserver(onResize);

      resizeObserver.observe(scrollContainer);
      return () => {
        resizeObserver.disconnect();
      };
    }, [editor, selectedView, node]);

    return (
      <>
        <div
          {...attributes}
          contentEditable={readOnly ? false : undefined}
          className={`relative w-full cursor-pointer`}
          onMouseEnter={() => {
            if (variant === UIVariant.App && !readOnly) {
              setShowActions(true);
            }
          }}
          onMouseLeave={() => {
            setShowActions(false);
          }}
        >
          <div
            ref={ref}
            className={'absolute left-0 top-0 h-full w-full caret-transparent'}
          >
            {children}
          </div>

          <div
            contentEditable={false}
            ref={containerRef}
            className={`container-bg relative select-none my-1 relative flex w-full flex-col`}
          >
            {selectedViewId && doc ? (
              <div
                className={'relative'}
                style={{
                  left: `-${paddingStart}px`,
                  width,
                }}
              >
                <Database
                  workspaceId={workspaceId}
                  doc={doc}
                  iidIndex={viewId}
                  viewId={selectedViewId}
                  createRowDoc={createRowDoc}
                  loadView={loadView}
                  navigateToView={navigateToView}
                  onOpenRow={handleNavigateToRow}
                  loadViewMeta={loadViewMeta}
                  iidName={iidName}
                  visibleViewIds={visibleViewIds}
                  onChangeView={setSelectedViewId}
                  showActions={showActions}
                  paddingStart={paddingStart}
                  paddingEnd={paddingEnd}
                  isDocumentBlock={true}
                />
              </div>
            ) : (
              <div
                className={
                  'flex h-full py-10 w-full flex-col items-center justify-center gap-2 rounded bg-background-primary px-16 text-text-caption max-md:px-4'
                }
              >
                {notFound ? (
                  <>
                    <div className={'text-base font-medium'}>{t('publish.hasNotBeenPublished')}</div>
                  </>
                ) : (
                  <CircularProgress size={20} />
                )}
              </div>
            )}
          </div>

        </div>
      </>
    );
  }),
  (prevProps, nextProps) => prevProps.node.data.view_id === nextProps.node.data.view_id,
);

export default DatabaseBlock;
