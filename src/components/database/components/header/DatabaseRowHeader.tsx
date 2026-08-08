import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  RowMeta,
  RowMetaKey,
  useCellSelector,
  useDatabase,
  useDatabaseContext,
  usePrimaryFieldId,
  useReadOnly,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { rowDocumentIdFromRowId, syncRowDocumentViewName } from '@/application/row-document/lifecycle';
import { setActiveRowPage } from '@/application/row-document/row-page-state';
import {
  AppendBreadcrumb,
  CoverType,
  RowCoverType,
  ViewIconType,
  ViewLayout,
  ViewMetaCover,
  YjsDatabaseKey,
} from '@/application/types';
import ImageRender from '@/components/_shared/image-render/ImageRender';
import {
  normalizeRowDocumentViewName,
  shouldSyncRowDocumentViewName,
} from '@/components/database/components/header/rowDocumentViewName';
import Title from '@/components/database/components/header/Title';
import { getScrollParent } from '@/components/global-comment/utils';
import ViewCoverActions from '@/components/view-meta/ViewCoverActions';
import { renderColor } from '@/utils/color';
import { clampCoverOffset, coverOffsetToObjectPosition } from '@/utils/cover';

function DatabaseRowHeader({ rowId, appendBreadcrumb }: { rowId: string; appendBreadcrumb?: AppendBreadcrumb }) {
  const fieldId = usePrimaryFieldId() || '';

  const ref = React.useRef<HTMLDivElement>(null);
  const [offsetLeft, setOffsetLeft] = React.useState(0);
  const [width, setWidth] = React.useState<number | undefined>(undefined);
  const meta = useRowMetaSelector(rowId);
  const cover = meta?.cover;
  const readOnly = useReadOnly();
  const [hoveredCover, setShowAction] = useState(false);
  const context = useDatabaseContext();
  const isDatabaseRowPage = context?.isDatabaseRowPage;
  const workspaceId = context?.workspaceId;
  const database = useDatabase();
  const databaseId = database?.get(YjsDatabaseKey.id) as string | undefined;
  const databaseViewId = context?.activeViewId || context?.databasePageId;

  const updateRowMeta = useUpdateRowMetaDispatch(rowId);

  const onUpdateCover = useCallback(
    (cover: ViewMetaCover) => {
      if (readOnly) return;

      // eslint-disable-next-line
      // @ts-ignore
      const coverTypeMap: Record<CoverType, RowCoverType> = {
        [CoverType.GradientColor]: RowCoverType.GradientCover,
        [CoverType.NormalColor]: RowCoverType.ColorCover,
        [CoverType.BuildInImage]: RowCoverType.AssetCover,
        [CoverType.CustomImage]: RowCoverType.FileCover,
        [CoverType.UpsplashImage]: RowCoverType.FileCover,
      };
      const coverType = coverTypeMap[cover.type];
      const offset = clampCoverOffset(cover.offset);

      updateRowMeta(
        RowMetaKey.CoverId,
        JSON.stringify({
          cover_type: coverType,
          data: cover.value,
          offset,
        })
      );
    },
    [readOnly, updateRowMeta]
  );

  const onRemoveCover = useCallback(() => {
    if (readOnly) return;
    setShowAction(false);

    updateRowMeta(RowMetaKey.CoverId, '');
  }, [readOnly, updateRowMeta]);

  const renderCoverImage = useCallback((cover: RowMeta['cover']) => {
    if (!cover) return null;

    if (cover.cover_type === RowCoverType.GradientCover || cover.cover_type === RowCoverType.ColorCover) {
      return (
        <div
          style={{
            background: renderColor(cover.data),
          }}
          className={`h-full w-full`}
        />
      );
    }

    let url: string | undefined = cover.data;

    if (cover.cover_type === RowCoverType.AssetCover) {
      url = {
        1: '/covers/m_cover_image_1.png',
        2: '/covers/m_cover_image_2.png',
        3: '/covers/m_cover_image_3.png',
        4: '/covers/m_cover_image_4.png',
        5: '/covers/m_cover_image_5.png',
        6: '/covers/m_cover_image_6.png',
      }[Number(cover.data)];
    }

    if (!url) return null;

    const objectPosition = coverOffsetToObjectPosition(cover.offset);

    return (
      <>
        <ImageRender
          draggable={false}
          src={url}
          alt={''}
          className={'h-full w-full object-cover'}
          style={{
            objectPosition,
          }}
        />
      </>
    );
  }, []);

  const cell = useCellSelector({
    rowId,
    fieldId,
  });

  useEffect(() => {
    appendBreadcrumb?.({
      children: [],
      extra: null,
      is_private: false,
      is_published: false,
      layout: ViewLayout.Document,
      view_id: rowId,
      name: cell?.data as string,
      icon: meta?.icon
        ? {
            ty: ViewIconType.Emoji,
            value: meta.icon,
          }
        : null,
    });
  }, [appendBreadcrumb, cell?.data, meta, rowId]);

  useEffect(() => {
    return () => {
      appendBreadcrumb?.(undefined);
    };
  }, [appendBreadcrumb]);

  const title = (cell?.data as string) || '';
  const documentId = meta?.documentId || rowDocumentIdFromRowId(rowId);
  const hasDocument = meta?.isEmptyDocument === false;

  // Publish the active row page so app chrome outside the database context
  // (header favorite button) can target the row document instead of the database.
  useEffect(() => {
    if (!isDatabaseRowPage) return;

    setActiveRowPage({
      rowId,
      documentId,
      title,
      source:
        databaseId && databaseViewId
          ? { database_id: databaseId, database_view_id: databaseViewId, row_id: rowId }
          : null,
      hasDocument,
    });

    return () => {
      setActiveRowPage(null);
    };
  }, [isDatabaseRowPage, rowId, documentId, title, hasDocument, databaseId, databaseViewId]);

  // Keep the row-document view name in sync with the primary cell so
  // favorites/trash entries show the row title. Sync only from title edits
  // made in this header: observing cell state cannot distinguish a user edit
  // from the loading sequence (empty placeholder doc → loaded title), which
  // used to push a spurious update-name on every row page open. Loads and
  // remote renames never sync — the editing client pushes its own rename, and
  // explicit actions (favorite/delete) push the current title themselves.
  const titleSyncTimerRef = useRef<number | undefined>(undefined);
  const lastSyncedTitleRef = useRef<string>('');

  const onTitleEdited = useCallback(
    (editedTitle: string) => {
      if (readOnly || !hasDocument || !documentId || !workspaceId) return;

      const name = normalizeRowDocumentViewName(editedTitle);

      if (!shouldSyncRowDocumentViewName(lastSyncedTitleRef.current, name)) return;

      window.clearTimeout(titleSyncTimerRef.current);
      titleSyncTimerRef.current = window.setTimeout(() => {
        lastSyncedTitleRef.current = name;
        void syncRowDocumentViewName(workspaceId, documentId, name);
      }, 500);
    },
    [readOnly, hasDocument, documentId, workspaceId]
  );

  useEffect(() => {
    return () => {
      window.clearTimeout(titleSyncTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;

    if (!el) return;

    const container = el.closest('.appflowy-scroll-container') || getScrollParent(el);

    if (!container) return;

    const handleResize = () => {
      setOffsetLeft(container.getBoundingClientRect().left - el.getBoundingClientRect().left);
      setWidth(container.getBoundingClientRect().width);
    };

    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={'relative flex flex-col'}>
      <div className={'row-header-cover relative'} style={{ left: offsetLeft, width }}>
        {cover && cover.data && (
          <div
            style={{
              height: isDatabaseRowPage ? '40vh' : '25vh',
              maxHeight: isDatabaseRowPage ? '288px' : '200px',
            }}
            onMouseEnter={() => setShowAction(true)}
            onMouseLeave={() => setShowAction(false)}
            className={'relative flex min-h-[130px] w-full max-sm:h-[180px]'}
          >
            {renderCoverImage(cover)}
            {!readOnly && (
              <ViewCoverActions
                show={hoveredCover}
                onUpdateCover={onUpdateCover}
                onRemove={onRemoveCover}
                coverValue={cover.data}
              />
            )}
          </div>
        )}
      </div>
      <Title
        rowId={rowId}
        fieldId={fieldId}
        icon={meta?.icon}
        name={cell?.data as string}
        hasCover={!!cover}
        onEdited={onTitleEdited}
      />
    </div>
  );
}

export default DatabaseRowHeader;
