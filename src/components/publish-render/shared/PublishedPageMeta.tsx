import { useMemo } from 'react';

import { ViewExtra, ViewLayout, ViewMetaCover } from '@/application/types';
import { documentMaxWidth, parseDocumentWidth } from '@/application/document-width';
import type { PublishedView } from '@/application/publish-snapshot/types';
import ViewMetaPreview from '@/components/view-meta/ViewMetaPreview';
import { clampCoverOffset } from '@/utils/cover';

export function parsePublishedViewExtra(extra?: string | null): Record<string, unknown> | null {
  if (!extra) return null;

  try {
    const value = JSON.parse(extra);

    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function getPublishedViewCover(extra: Record<string, unknown> | null): ViewMetaCover | undefined {
  const rawCover = extra?.cover as ViewMetaCover | undefined;

  if (!rawCover) return undefined;

  return {
    ...rawCover,
    offset: clampCoverOffset(rawCover.offset),
  };
}

export function PublishedPageMeta({
  view,
  layout = view.layout,
  maxWidth,
}: {
  view: PublishedView;
  layout?: ViewLayout;
  maxWidth?: number;
}) {
  const extra = useMemo(() => parsePublishedViewExtra(view.extra), [view.extra]);
  const cover = useMemo(() => getPublishedViewCover(extra), [extra]);
  const pageMaxWidth = layout === ViewLayout.Document
    ? documentMaxWidth(parseDocumentWidth(extra?.document_width))
    : 952;

  return (
    <ViewMetaPreview
      readOnly
      icon={view.icon || undefined}
      cover={cover}
      name={view.name}
      viewId={view.viewId}
      layout={layout}
      maxWidth={maxWidth ?? pageMaxWidth}
      extra={extra as ViewExtra | null}
    />
  );
}

export default PublishedPageMeta;
