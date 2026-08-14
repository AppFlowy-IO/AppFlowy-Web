import { useEffect, useState } from 'react';

import { RowMeta, useCellSelector, useDatabaseContext } from '@/application/database-yjs';
import { FileMediaCellDataItem, FileMediaType } from '@/application/database-yjs/cell.type';
import { rowDocumentIdFromRowId } from '@/application/row-document/lifecycle';
import { getBlock, getBlocks, getChildrenArray, getPageId } from '@/application/slate-yjs/utils/yjs';
import {
  BlockType,
  GalleryBlockData,
  GalleryCardPreview,
  ImageBlockData,
  RowCoverType,
  YDoc,
  YSharedRoot,
  YjsEditorKey,
} from '@/application/types';
import { useAuthenticatedImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';
import { resolveFileUrl } from '@/utils/file-storage-url';

import { GALLERY_COVER_PLACEHOLDER_BACKGROUND_CLASS_NAME } from './gallery.constants';

const BUILT_IN_COVERS: Record<number, string> = {
  1: '/covers/m_cover_image_1.png',
  2: '/covers/m_cover_image_2.png',
  3: '/covers/m_cover_image_3.png',
  4: '/covers/m_cover_image_4.png',
  5: '/covers/m_cover_image_5.png',
  6: '/covers/m_cover_image_6.png',
};

const rowDocumentLoads = new Map<string, Promise<YDoc | null>>();

function readBlockData<T>(data: unknown): T | null {
  if (typeof data === 'object' && data !== null) return data as T;
  if (typeof data !== 'string' || !data) return null;

  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/** Find the first image in document order, including nested image galleries. */
export function findFirstDocumentImage(sharedRoot: YSharedRoot): string | null {
  if (!sharedRoot.has(YjsEditorKey.document)) return null;

  const visited = new Set<string>();
  const visit = (blockId: string): string | null => {
    if (!blockId || visited.has(blockId)) return null;
    visited.add(blockId);

    const block = getBlock(blockId, sharedRoot);

    if (!block) return null;

    const blockType = block.get(YjsEditorKey.block_type);

    if (blockType === BlockType.ImageBlock) {
      const data = readBlockData<ImageBlockData>(block.get(YjsEditorKey.block_data));

      if (data?.url) return data.url;
    }

    if (blockType === BlockType.GalleryBlock) {
      const data = readBlockData<GalleryBlockData>(block.get(YjsEditorKey.block_data));
      const image = data?.images?.find((item) => Boolean(item?.url));

      if (image?.url) return image.url;
    }

    const childrenId = block.get(YjsEditorKey.block_children);
    const children = childrenId ? getChildrenArray(childrenId, sharedRoot)?.toArray() ?? [] : [];

    for (const childId of children) {
      const url = visit(childId);

      if (url) return url;
    }

    return null;
  };

  try {
    const result = visit(getPageId(sharedRoot));

    if (result) return result;
  } catch {
    // Partially hydrated documents may not have page metadata yet. Fall back
    // to map order so the preview can still become useful during sync.
  }

  for (const blockId of getBlocks(sharedRoot).keys()) {
    const result = visit(blockId);

    if (result) return result;
  }

  return null;
}

function usePageContentImage(rowId: string, enabled: boolean): string | null {
  const { loadRowDocument, workspaceId } = useDatabaseContext();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let observedDoc: YDoc | null = null;
    const documentId = rowDocumentIdFromRowId(rowId);

    if (!enabled || !documentId || !loadRowDocument) {
      setUrl(null);
      return;
    }

    const cacheKey = `${workspaceId}/${documentId}`;
    let request = rowDocumentLoads.get(cacheKey);

    if (!request) {
      const pendingRequest = loadRowDocument(documentId).catch(() => null);

      rowDocumentLoads.set(cacheKey, pendingRequest);
      void pendingRequest.then(() => {
        if (rowDocumentLoads.get(cacheKey) === pendingRequest) rowDocumentLoads.delete(cacheKey);
      });
      request = pendingRequest;
    }

    const update = () => {
      if (!observedDoc || cancelled) return;
      const sharedRoot = observedDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
      const imageUrl = findFirstDocumentImage(sharedRoot);

      setUrl(imageUrl ? resolveFileUrl(imageUrl, workspaceId, documentId) : null);
    };

    void request.then((doc) => {
      if (cancelled || !doc) return;
      observedDoc = doc;
      update();
      doc.on('update', update);
    });

    return () => {
      cancelled = true;
      observedDoc?.off('update', update);
    };
  }, [enabled, loadRowDocument, rowId, workspaceId]);

  return enabled ? url : null;
}

function getPageCover(cover: RowMeta['cover']): { background?: string; src?: string } {
  if (!cover?.data) return {};

  if (cover.cover_type === RowCoverType.GradientCover || cover.cover_type === RowCoverType.ColorCover) {
    return { background: renderColor(cover.data) };
  }

  const src = cover.cover_type === RowCoverType.AssetCover ? BUILT_IN_COVERS[Number(cover.data)] : cover.data;

  return src ? { src } : {};
}

function getFirstMediaImage(data: unknown): FileMediaCellDataItem | null {
  if (!Array.isArray(data)) return null;

  return (
    (data as FileMediaCellDataItem[]).find((item) => item?.file_type === FileMediaType.Image && Boolean(item.url)) ??
    null
  );
}

interface GalleryPreviewValue {
  background?: string;
  src?: string;
}

function GalleryPreviewImage({ fitImage, rowId, src }: { fitImage: boolean; rowId: string; src: string }) {
  const authenticatedSrc = useAuthenticatedImage(src);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [authenticatedSrc]);

  if (failed || !authenticatedSrc) return null;

  return (
    <img
      alt=''
      className={cn('h-full w-full', fitImage ? 'object-contain' : 'object-cover', !loaded && 'invisible')}
      data-testid={`gallery-card-preview-image-${rowId}`}
      draggable={false}
      onError={() => setFailed(true)}
      onLoad={() => setLoaded(true)}
      src={authenticatedSrc}
    />
  );
}

function GalleryPreviewFrame({
  fitImage,
  preview,
  rowId,
  value,
}: {
  fitImage: boolean;
  preview: GalleryCardPreview;
  rowId: string;
  value: GalleryPreviewValue;
}) {
  return (
    <div
      className={cn(
        'gallery-card-cover-placeholder h-full w-full overflow-hidden',
        value.src
          ? preview === GalleryCardPreview.PageCover
            ? 'bg-white [[data-dark-mode=true]_&]:bg-[#282E3A]'
            : 'bg-[var(--gallery-card-surface)]'
          : GALLERY_COVER_PLACEHOLDER_BACKGROUND_CLASS_NAME
      )}
      data-gallery-preview={preview}
      data-testid={`gallery-card-preview-${rowId}`}
      style={value.background ? { background: value.background } : undefined}
    >
      {value.src ? <GalleryPreviewImage fitImage={fitImage} rowId={rowId} src={value.src} /> : null}
    </div>
  );
}

function PageCoverPreview({
  fitImage,
  meta,
  rowId,
}: {
  fitImage: boolean;
  meta: RowMeta | null | undefined;
  rowId: string;
}) {
  return (
    <GalleryPreviewFrame
      fitImage={fitImage}
      preview={GalleryCardPreview.PageCover}
      rowId={rowId}
      value={getPageCover(meta?.cover ?? null)}
    />
  );
}

function FilesAndMediaPreview({
  coverFieldId,
  fitImage,
  rowId,
}: {
  coverFieldId?: string;
  fitImage: boolean;
  rowId: string;
}) {
  const { databasePageId, workspaceId } = useDatabaseContext();
  const mediaCell = useCellSelector({ fieldId: coverFieldId ?? '', rowId });
  const media = getFirstMediaImage(mediaCell?.data);
  const value = media?.url ? { src: resolveFileUrl(media.url, workspaceId, databasePageId) } : {};

  return (
    <GalleryPreviewFrame fitImage={fitImage} preview={GalleryCardPreview.FilesAndMedia} rowId={rowId} value={value} />
  );
}

function PageContentPreview({
  fitImage,
  meta,
  rowId,
}: {
  fitImage: boolean;
  meta: RowMeta | null | undefined;
  rowId: string;
}) {
  const pageContentUrl = usePageContentImage(rowId, meta?.isEmptyDocument === false);

  return (
    <GalleryPreviewFrame
      fitImage={fitImage}
      preview={GalleryCardPreview.PageContent}
      rowId={rowId}
      value={pageContentUrl ? { src: pageContentUrl } : {}}
    />
  );
}

export function GalleryPreview({
  coverFieldId,
  fitImage,
  meta,
  preview,
  rowId,
}: {
  coverFieldId?: string;
  fitImage: boolean;
  meta: RowMeta | null | undefined;
  preview: GalleryCardPreview;
  rowId: string;
}) {
  if (preview === GalleryCardPreview.PageCover) {
    return <PageCoverPreview fitImage={fitImage} meta={meta} rowId={rowId} />;
  }

  if (preview === GalleryCardPreview.FilesAndMedia) {
    return <FilesAndMediaPreview coverFieldId={coverFieldId} fitImage={fitImage} rowId={rowId} />;
  }

  return <PageContentPreview fitImage={fitImage} meta={meta} rowId={rowId} />;
}

export default GalleryPreview;
