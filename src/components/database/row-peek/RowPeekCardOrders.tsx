import type { ReactNode } from 'react';

import { useFieldsSelector, usePrimaryFieldId, useRowOrdersSelector } from '@/application/database-yjs';
import type { RowOrdersPresentation } from '@/application/database-yjs/row-orders-store';
import type { Row } from '@/application/database-yjs/selector';
import type { YDoc } from '@/application/types';
import { useFeedRowData } from '@/components/database/feed/useFeedRowOrders';
import { useFeedSearch } from '@/components/database/feed/useFeedSearch';
import { useGalleryFields } from '@/components/database/gallery/useGalleryFields';

type OrdersProps = { query: string; children: (rows: Row[] | undefined) => ReactNode };
const NO_CACHED_ROW_DOCS: Record<string, YDoc> = {};

function FeedOrders({ query, children }: OrdersProps) {
  const fields = useFieldsSelector();
  const primaryFieldId = usePrimaryFieldId();
  const { rowOrders, cachedRowDocs } = useFeedRowData(Boolean(query.trim()));
  const rows = useFeedSearch({ rows: rowOrders, fields, primaryFieldId, cachedRowDocs, query });

  return <>{children(rows)}</>;
}

function GalleryOrders({ query, children }: OrdersProps) {
  const fields = useGalleryFields();
  const primaryFieldId = fields.find((field) => field.isPrimary)?.fieldId;
  const rowOrders = useRowOrdersSelector({ publish: false });
  const rows = useFeedSearch({ rows: rowOrders, fields, primaryFieldId, cachedRowDocs: NO_CACHED_ROW_DOCS, query });

  return <>{children(rows)}</>;
}

/** Reuse each card view's data hooks without keeping its offscreen UI mounted. */
export default function RowPeekCardOrders({
  presentation,
  children,
}: {
  presentation: RowOrdersPresentation;
  children: OrdersProps['children'];
}) {
  return presentation.layout === 'feed' ? (
    <FeedOrders query={presentation.query}>{children}</FeedOrders>
  ) : (
    <GalleryOrders query={presentation.query}>{children}</GalleryOrders>
  );
}
