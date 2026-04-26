import React, { Suspense } from 'react';

import PublishedDocumentRenderer from '@/components/publish-render/document/PublishedDocumentRenderer';
import PublishedDatabaseRenderer from '@/components/publish-render/database/PublishedDatabaseRenderer';
import type { PublishedPageSnapshot } from '@/application/publish-snapshot/types';
import { usePublishContext } from '@/application/publish';

const ViewHelmet = React.lazy(() => import('@/components/_shared/helmet/ViewHelmet'));

export function PublishSnapshotView({ snapshot }: { snapshot: PublishedPageSnapshot }) {
  const rendered = usePublishContext()?.rendered;

  return (
    <>
      {rendered && (
        <Suspense>
          <ViewHelmet icon={snapshot.view.icon || undefined} name={snapshot.view.name} />
        </Suspense>
      )}
      {snapshot.kind === 'document' ? (
        <PublishedDocumentRenderer snapshot={snapshot} />
      ) : (
        <PublishedDatabaseRenderer snapshot={snapshot} />
      )}
    </>
  );
}

export default PublishSnapshotView;
