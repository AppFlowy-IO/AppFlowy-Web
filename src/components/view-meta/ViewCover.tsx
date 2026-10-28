import { lazy, Suspense, useRef, useState } from 'react';

import { ViewLayout, ViewMetaCover } from '@/application/types';
import ViewCoverContent from '@/components/view-meta/ViewCoverContent';

const ViewCoverActions = lazy(() => import('@/components/view-meta/ViewCoverActions'));

function ViewCover({
  coverValue,
  coverType,
  onUpdateCover,
  onRemoveCover,
  readOnly = true,
  layout,
  coverOffset,
}: {
  coverValue?: string;
  coverType?: string;
  onUpdateCover: (cover: ViewMetaCover) => void;
  onRemoveCover: () => void;
  readOnly?: boolean;
  layout?: ViewLayout;
  coverOffset?: number;
}) {
  const [showAction, setShowAction] = useState(false);

  const actionRef = useRef<HTMLDivElement>(null);

  if (!coverType || !coverValue) {
    return null;
  }

  return (
    <div
      onMouseEnter={() => {
        if (readOnly) return;
        setShowAction(true);
      }}
      onMouseLeave={() => {
        setShowAction(false);
      }}
      style={{
        height: layout === ViewLayout.Document ? '40vh' : '25vh',
        maxHeight: layout === ViewLayout.Document ? '288px' : '200px',
      }}
      className={'relative flex min-h-[130px] w-full max-sm:h-[180px]'}
    >
      <ViewCoverContent coverType={coverType} coverValue={coverValue} coverOffset={coverOffset} />
      {!readOnly && (
        <Suspense>
          <ViewCoverActions
            coverValue={coverValue}
            show={showAction}
            ref={actionRef}
            fullWidth={layout !== ViewLayout.Document}
            onUpdateCover={onUpdateCover}
            onRemove={onRemoveCover}
          />
        </Suspense>
      )}
    </div>
  );
}

export default ViewCover;
