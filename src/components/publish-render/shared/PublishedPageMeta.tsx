import { useMemo } from 'react';

import { ViewExtra, ViewLayout, ViewMetaCover } from '@/application/types';
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
  maxWidth = 952,
}: {
  view: PublishedView;
  layout?: ViewLayout;
  maxWidth?: number;
}) {
  const extra = useMemo(() => parsePublishedViewExtra(view.extra), [view.extra]);
  const cover = useMemo(() => getPublishedViewCover(extra), [extra]);

  return (
    <ViewMetaPreview
      readOnly
      icon={view.icon || undefined}
      cover={cover}
      name={view.name}
      viewId={view.viewId}
      layout={layout}
      maxWidth={maxWidth}
      extra={extra as ViewExtra | null}
    />
  );
}

export default PublishedPageMeta;
